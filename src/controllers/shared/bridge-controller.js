'use strict';

const { decorator } = require('../../../packages/api-utils');
const bridgeService = require('../../services/shared/bridge-service');

/**
 * Rejects a request whose required params are missing, before any upstream
 * call. Without this the provider answers for us, and its message is written
 * for its own API: a request with no `symbolOut` produced
 * "Exchange pair must be non-circular" (because the URL became
 * `/undefined/undefined`), and one with no `amount` leaked StealthEX's
 * internal validation text.
 *
 * @param {import('express').Response} res
 * @param {Object} source - `req.query` or `req.body`.
 * @param {string[]} required
 * @returns {boolean} true when a 400 was sent.
 */
const rejectMissingParams = (res, source, required) => {
  const missing = required.filter((key) => !source?.[key]);
  if (missing.length === 0) return false;

  res.status(400).send({
    error: 'missing_parameter',
    error_description: `Missing required query params: ${missing.join(', ')}`,
  });
  return true;
};

/** Amount must be a positive finite number before it is worth an upstream call. */
const rejectInvalidAmount = (res, amount) => {
  const parsed = Number(amount);
  if (Number.isFinite(parsed) && parsed > 0) return false;

  res.status(400).send({
    error: 'invalid_parameter',
    error_description: 'amount must be a positive number.',
  });
  return true;
};
const decorateBridgeToken = require('../../resources/shared/bridge-token-resource');
const decorateBridgeExchange = require('../../resources/shared/bridge-exchange-resource');

/**
 * Lists tokens available for bridging against `symbol`.
 *
 * `symbol` is required: without it the upstream pair lookup resolves to a
 * bogus URL and the endpoint answered `200 []`, which reads to the client as
 * "no pairs exist" rather than "you sent a bad request".
 *
 * @param {import('express').Request} req - Reads `query.symbol` (required);
 *   the rest of `req.query` passes through to `bridgeService.available`.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   bridge-token list resource; 400 `missing_parameter` when `symbol` is absent.
 * @returns {Promise<void>}
 */
const listAvailable = async (req, res) => {
  if (rejectMissingParams(res, req.query, ['symbol'])) return undefined;

  const data = await bridgeService.available(req.query);
  const resource = await decorator(decorateBridgeToken, data, { req, res });
  return res.status(200).send(resource);
};

/**
 * Returns a bridge swap estimate.
 *
 * @param {import('express').Request} req - Passes `req.query` through to
 *   `bridgeService.estimate`.
 * @param {import('express').Response} res - Responds 200 with the raw estimate data.
 * @returns {Promise<void>}
 */
const getEstimate = async (req, res) => {
  if (rejectMissingParams(res, req.query, ['symbolIn', 'symbolOut', 'amount'])) return undefined;
  if (rejectInvalidAmount(res, req.query.amount)) return undefined;

  const data = await bridgeService.estimate(req.query);
  return res.status(200).send(data);
};

/**
 * Returns the minimum input amount accepted for a bridge exchange.
 *
 * @param {import('express').Request} req - Passes `req.query` through to
 *   `bridgeService.minimal`.
 * @param {import('express').Response} res - Responds 200 with the raw minimal-amount
 *   data.
 * @returns {Promise<void>}
 */
const getMinimalAmountIn = async (req, res) => {
  if (rejectMissingParams(res, req.query, ['symbolIn', 'symbolOut'])) return undefined;

  const data = await bridgeService.minimal(req.query);
  return res.status(200).send(data);
};

/**
 * Runs exchange creation for already-extracted params and responds with the
 * decorated resource. Shared by the query and body variants so both routes
 * return the exact same contract.
 *
 * @param {Object} params - `{symbolIn, symbolOut, amount, addressTo}`.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const respondWithExchange = async (params, req, res) => {
  const required = ['symbolIn', 'symbolOut', 'amount', 'addressTo'];
  if (rejectMissingParams(res, params, required)) return undefined;
  if (rejectInvalidAmount(res, params.amount)) return undefined;

  const data = await bridgeService.create(params);
  const resource = await decorator(decorateBridgeExchange, data, { req, res });
  return res.status(200).send(resource);
};

/**
 * Creates a bridge exchange from query params.
 *
 * Legacy variant kept for already-shipped clients: creation is a side effect,
 * so `GET` is not safe to retry. New clients should use `createExchangeFromBody`
 * (`POST /v1/bridge/exchange`).
 *
 * @param {import('express').Request} req - Passes `req.query` through to
 *   `bridgeService.create`.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   bridge-exchange resource (camelCase public shape).
 * @returns {Promise<void>}
 */
const createExchange = async (req, res) => respondWithExchange(req.query, req, res);

/**
 * Creates a bridge exchange from the JSON request body.
 *
 * Preferred variant: clients retry failed GETs (network error / 5xx), which
 * can duplicate upstream orders when the response is lost after creation.
 *
 * @param {import('express').Request} req - Passes `req.body` through to
 *   `bridgeService.create`.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   bridge-exchange resource (camelCase public shape).
 * @returns {Promise<void>}
 */
const createExchangeFromBody = async (req, res) => respondWithExchange(req.body || {}, req, res);

/**
 * Returns the status of a bridge exchange.
 *
 * @param {import('express').Request} req - Passes `req.query` through to
 *   `bridgeService.getTransaction`.
 * @param {import('express').Response} res - Responds 200 with the decorated
 *   bridge-exchange resource.
 * @returns {Promise<void>}
 */
const getTransaction = async (req, res) => {
  if (rejectMissingParams(res, req.query, ['id'])) return undefined;

  const data = await bridgeService.getTransaction(req.query);
  const resource = await decorator(decorateBridgeExchange, data, { req, res });
  return res.status(200).send(resource);
};

module.exports = {
  listAvailable,
  getEstimate,
  getMinimalAmountIn,
  createExchange,
  createExchangeFromBody,
  getTransaction,
};
