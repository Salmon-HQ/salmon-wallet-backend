'use strict';

const service = require('../../services/shared/coingecko-service');

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
  const { coinId } = req.params;
  const { days, currency } = req.query;
  const data = await service.getMarketChart({ coinId, days, currency }, res.locals);
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
  const { platform, address } = req.params;
  const { days, currency } = req.query;
  try {
    const data = await service.getContractMarketChart(
      { platform, contractAddress: address, days, currency },
      res.locals
    );
    res.status(200).send(data);
  } catch (error) {
    if (error?.response?.status === 404) {
      // The route sets a 5-minute Cache-Control for the success case; leaving
      // it on lets CloudFront hold the 404 for as long, so a token that gets
      // listed stays "unlisted" for the client. The error middleware strips it
      // for the errors it handles — this branch answers directly, so it has to
      // strip it itself.
      res.removeHeader('Cache-Control');
      res.status(404).send({
        error: 'chart_not_found',
        error_description: `No CoinGecko chart for contract ${address} on ${platform}.`,
      });
      return;
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
  const { coinId } = req.params;
  const { currency } = req.query;
  const data = await service.getCoinInfo({ coinId, currency }, res.locals);
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
  const { platform, address } = req.params;
  const { currency } = req.query;
  try {
    const data = await service.getContractCoinInfo(
      { platform, contractAddress: address, currency },
      res.locals
    );
    res.status(200).send(data);
  } catch (error) {
    if (error?.response?.status === 404) {
      // The route sets a 5-minute Cache-Control for the success case; leaving
      // it on lets CloudFront hold the 404 for as long, so a token that gets
      // listed stays "unlisted" for the client. The error middleware strips it
      // for the errors it handles — this branch answers directly, so it has to
      // strip it itself.
      res.removeHeader('Cache-Control');
      res.status(404).send({
        error: 'info_not_found',
        error_description: `No CoinGecko coin info for contract ${address} on ${platform}.`,
      });
      return;
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
