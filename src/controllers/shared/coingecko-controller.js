'use strict';

const service = require('../../services/shared/coingecko-service');

/**
 * Answers 404 for a contract CoinGecko does not list. The route sets a
 * 5-minute Cache-Control for the success case; leaving it on lets CloudFront
 * hold the 404 for as long, so a token that gets listed stays "unlisted" for
 * the client. The error middleware strips it for the errors it handles — this
 * path answers directly, so it strips it itself.
 */
// A CoinGecko id is lowercase letters, digits and hyphens; a contract address
// is base58 or 0x-hex. Anything else is garbage that would still cost one
// upstream call per spelling, since each spelling is its own cache entry.
const COIN_ID = /^[a-z0-9-]{1,64}$/;
const CONTRACT_ADDRESS = /^[A-Za-z0-9]{1,64}$/;
const PLATFORM = /^[a-z0-9-]{1,32}$/;

const respondInvalid = (res, error_description) =>
  res.status(400).json({ error: 'invalid_parameter', error_description });

/**
 * Normalises `days` to `'ytd'`, `'max'` or an integer string from 1 to the
 * free-tier maximum, so `7`, `07` and `7.0` share one cache entry; returns
 * `null` for anything else.
 */
const normalizeDays = (days) => {
  if (days === undefined) return undefined;
  if (days === 'ytd' || days === 'max') return days;
  const value = Number(days);
  if (!Number.isInteger(value) || value < 1) return null;
  return String(Math.min(value, service.MAX_DAYS_FREE_TIER));
};

const normalizeCurrency = (currency) => {
  if (currency === undefined) return undefined;
  const value = String(currency).toLowerCase();
  return service.SUPPORTED_FIAT_CURRENCIES.includes(value) ? value : null;
};

/** Validated `{ days, currency }` from the query, or a 400 already sent. */
const marketParams = (req, res, { withDays }) => {
  const currency = normalizeCurrency(req.query.currency);
  if (currency === null) {
    respondInvalid(res, `currency must be one of ${service.SUPPORTED_FIAT_CURRENCIES.join(', ')}`);
    return null;
  }
  if (!withDays) return { currency };
  const days = normalizeDays(req.query.days);
  if (days === null) {
    respondInvalid(
      res,
      `days must be ytd, max or a whole number from 1 to ${service.MAX_DAYS_FREE_TIER}`
    );
    return null;
  }
  return { days, currency };
};

/** Validated `{ coinId }` or `{ platform, address }` from the path, or a 400 already sent. */
const subjectParams = (req, res) => {
  const { coinId, platform, address } = req.params;
  if (coinId !== undefined) {
    if (!COIN_ID.test(coinId)) {
      respondInvalid(res, 'coinId must be a CoinGecko coin id');
      return null;
    }
    return { coinId };
  }
  if (!PLATFORM.test(platform) || !CONTRACT_ADDRESS.test(address)) {
    respondInvalid(
      res,
      'platform and address must be a CoinGecko platform id and a contract address'
    );
    return null;
  }
  return { platform, address };
};

const respondUnlisted = (res, error, error_description) => {
  res.removeHeader('Cache-Control');
  res.status(404).send({ error, error_description });
};

/**
 * Returns historical market chart data for a coin.
 *
 * @param {import('express').Request} req - Reads `params.coinId` and
 *   `query.days`/`query.currency`. Uses `res.locals` for network/currency context.
 * @param {import('express').Response} res - Responds 200 with the raw chart data
 *   (long-term-fallback policy applied by the service).
 * @returns {Promise<void>}
 */
const getMarketChart = async (req, res) => {
  const subject = subjectParams(req, res);
  const market = subject && marketParams(req, res, { withDays: true });
  if (!market) return;
  const data = await service.getMarketChart({ ...subject, ...market }, res.locals);
  res.status(200).send(data);
};

/**
 * Returns historical market chart data for a token by contract address
 * (mint). Unknown/unlisted contracts respond 404 `chart_not_found` — the
 * long tail of SPL tokens is expected to miss, so that is a contract case,
 * not a server error.
 *
 * @param {import('express').Request} req - Reads `params.platform`,
 *   `params.address`, and `query.days`/`query.currency`.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const getContractMarketChart = async (req, res) => {
  const subject = subjectParams(req, res);
  const market = subject && marketParams(req, res, { withDays: true });
  if (!market) return;
  const { platform, address } = subject;
  try {
    const data = await service.getContractMarketChart(
      { platform, contractAddress: address, ...market },
      res.locals
    );
    res.status(200).send(data);
  } catch (error) {
    if (error?.response?.status === 404) {
      return respondUnlisted(
        res,
        'chart_not_found',
        `No CoinGecko chart for contract ${address} on ${platform}.`
      );
    }
    throw error;
  }
};

/**
 * Returns detail info for a single coin.
 *
 * @param {import('express').Request} req - Reads `params.coinId` and `query.currency`.
 *   Uses `res.locals` for network/currency context.
 * @param {import('express').Response} res - Responds 200 with the raw coin-info data.
 * @returns {Promise<void>}
 */
const getCoinInfo = async (req, res) => {
  const subject = subjectParams(req, res);
  const market = subject && marketParams(req, res, { withDays: false });
  if (!market) return;
  const data = await service.getCoinInfo({ ...subject, ...market }, res.locals);
  res.status(200).send(data);
};

/**
 * Returns detail info for a token by contract address (mint), same shape as
 * `getCoinInfo` plus the resolved CoinGecko `id`. Unknown/unlisted contracts
 * respond 404 `info_not_found` — the long tail of SPL tokens is expected to
 * miss, so that is a contract case, not a server error.
 *
 * @param {import('express').Request} req - Reads `params.platform`,
 *   `params.address`, and `query.currency`.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const getContractCoinInfo = async (req, res) => {
  const subject = subjectParams(req, res);
  const market = subject && marketParams(req, res, { withDays: false });
  if (!market) return;
  const { platform, address } = subject;
  try {
    const data = await service.getContractCoinInfo(
      { platform, contractAddress: address, ...market },
      res.locals
    );
    res.status(200).send(data);
  } catch (error) {
    if (error?.response?.status === 404) {
      return respondUnlisted(
        res,
        'info_not_found',
        `No CoinGecko coin info for contract ${address} on ${platform}.`
      );
    }
    throw error;
  }
};

/**
 * Returns supported fiat exchange rates.
 *
 * @param {import('express').Request} _req - Unused; rates do not depend on request input.
 * @param {import('express').Response} res - Responds 200 with the raw exchange-rates data.
 * @returns {Promise<void>}
 */
const getExchangeRates = async (_req, res) => {
  const data = await service.getExchangeRates(res.locals);
  res.status(200).send(data);
};

module.exports = {
  getMarketChart,
  getContractMarketChart,
  getCoinInfo,
  getContractCoinInfo,
  getExchangeRates,
};
