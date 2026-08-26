'use strict';
const { applyConnectTuning } = require('../infrastructure/connect-tuning');
const http = require('axios');
const repository = require('../repositories/shared/coingecko-repository');
const { redis } = require('../repositories/data-source');

// Raise Node's 250ms per-address connect budget before any provider is
// dialed; see `infrastructure/connect-tuning` for why the default turns a
// slow handshake into a hard failure.
applyConnectTuning();

const BASE_ENDPOINT = 'https://api.coingecko.com';
const COINS_ENDPOINT = `${BASE_ENDPOINT}/api/v3/coins/list`;
const PRICE_ENDPOINT = `${BASE_ENDPOINT}/api/v3/simple/price`;

const DEFAULT_SYMBOLS = {
  bitcoin: 'btc',
  ethereum: 'eth',
  solana: 'sol',
};

const COINGECKO_RATE_LIMIT = 200;

/**
 * Scheduled job: fetch the CoinGecko token list for a single platform
 * (`solana` or `bitcoin`) and persist it to the CoinGecko repository
 * (Redis-backed). Existing per-token `last_updated` timestamps are
 * preserved so price-rotation cadence is not reset.
 *
 * Schedule (`serverless.yml`): `rate(1 hour)` for `bitcoin`
 * (`listTokensJobScheduleBtc`). The handler itself is platform-generic.
 *
 * Side effects:
 *   - HTTP GET to `api.coingecko.com/api/v3/coins/list`.
 *   - `repository.saveTokensList(...)` (Redis write).
 *
 * @param {{platform: 'solana'|'bitcoin'}} event
 * @returns {Promise<{statusCode: number, body: string}>}
 */
module.exports.listTokensJob = async (event) => {
  console.log(`Running job listTokenJob`);
  const { platform } = event;
  console.log(`Job platform ${platform}`);

  try {
    await listTokens(platform);
  } catch (error) {
    console.error('Error fetching tokens from CoinGecko:', error);
  }

  return createResponse('Token list job completed!');
};

/**
 * Fetch the CoinGecko token list, filter + tag it for `platform`, and persist
 * it. Shared by `listTokensJob` and as a lazy seed inside `refreshPricesJob`
 * when no token list exists yet.
 * @param {'solana'|'bitcoin'} platform
 * @returns {Promise<Array<object>>} The saved, platform-filtered token list.
 */
const listTokens = async (platform) => {
  const tokens = await fetchTokens();
  const existingList = await repository.getTokensList(platform);
  const tokensWithUpdatedAt = prepareTokens(tokens, platform, existingList);
  await repository.saveTokensList(tokensWithUpdatedAt, platform);
  return tokensWithUpdatedAt;
};

// Fetch tokens from CoinGecko
const fetchTokens = async () => {
  const { data } = await http.get(COINS_ENDPOINT, { params: { include_platform: true } });
  return data;
};

/**
 * Keep only tokens relevant to `platform` (matches by symbol or by having a
 * platform entry) and stamp each with `last_updated`, carried over from
 * `existingList` by id when present so the price-rotation cadence isn't reset.
 * @param {Array<object>} tokens - Raw CoinGecko token list.
 * @param {'solana'|'bitcoin'} platform
 * @param {Array<{id: string, last_updated: string|null}>|null} [existingList]
 * @returns {Array<object>} Filtered tokens with `last_updated` set.
 */
const prepareTokens = (tokens, platform, existingList = null) => {
  const byId = existingList ? new Map(existingList.map((t) => [t.id, t.last_updated])) : null;
  return tokens
    .filter(({ platforms, symbol }) => symbol === DEFAULT_SYMBOLS[platform] || platforms[platform])
    .map((token) => ({ ...token, last_updated: byId?.get(token.id) ?? null }));
};

/**
 * Pick the batch of tokens to refresh prices for this run, capped to
 * `COINGECKO_RATE_LIMIT`. Never-priced tokens (`last_updated` falsy) take
 * priority; only once none remain does it fall back to the globally oldest
 * `last_updated` tokens.
 * @param {Array<{id: string, last_updated: string|null}>} tokens
 * @returns {Array<object>} At most `COINGECKO_RATE_LIMIT` tokens.
 */
const getOldestTokens = (tokens) => {
  const neverUpdated = tokens.filter((t) => !t.last_updated).slice(0, COINGECKO_RATE_LIMIT);
  if (neverUpdated.length > 0) return neverUpdated;
  return tokens
    .sort((a, b) => new Date(a.last_updated) - new Date(b.last_updated))
    .slice(0, COINGECKO_RATE_LIMIT);
};

/**
 * Scheduled job: refresh USD prices for the oldest tokens (or every
 * never-priced token, capped to `COINGECKO_RATE_LIMIT`) and persist
 * the merged price map plus updated `last_updated` timestamps. If the
 * token list is empty, calls `listTokens(platform)` to seed it first.
 *
 * Schedule (`serverless.yml`): `rate(60 minutes)` for `bitcoin`
 * (`refreshPricesJobScheduleBtc`). The handler itself is platform-generic.
 *
 * Side effects:
 *   - HTTP GET to `api.coingecko.com/api/v3/simple/price`.
 *   - `repository.saveTokensPrices(...)` and `saveTokensList(...)`
 *     (Redis writes).
 *   - On local invocation (no `AWS_LAMBDA_FUNCTION_NAME`) closes Redis
 *     and calls `process.exit(0)` so the process terminates.
 *
 * @param {{platform: 'solana'|'bitcoin'}} event
 * @returns {Promise<{statusCode: number, body: string}>}
 */
module.exports.refreshPricesJob = async (event) => {
  console.log(`Running job refreshPricesJob`);
  const { platform } = event;
  console.log(`Job platform ${platform}`);

  try {
    let tokens = await repository.getTokensList(platform);
    if (!tokens) tokens = await listTokens(platform);

    const outdatedTokens = getOldestTokens(tokens);

    if (outdatedTokens.length === 0) {
      console.log('No tokens need price updates.');
      return createResponse('No tokens need price updates.');
    }

    const updatedPrices = await updatePrices(outdatedTokens, platform);
    updateLastUpdated(tokens, outdatedTokens);
    await repository.saveTokensPrices(updatedPrices, platform);
    await repository.saveTokensList(tokens, platform);
    return createResponse('Prices refresh job completed!');
  } catch (error) {
    console.error('Error fetching prices from CoinGecko:', error);
    return createResponse(`Prices refresh job failed: ${error.message}`);
  } finally {
    // On local invoke, close Redis and exit so the process terminates (Lambda reuses the connection)
    if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await redis.quit().catch(() => {});
      setImmediate(() => process.exit(0));
    }
  }
};

/**
 * Fetch fresh prices for `outdatedTokens` and merge them into the existing
 * price map for `platform`. Returns an empty array (no-op merge upstream)
 * when CoinGecko returns no prices.
 * @param {Array<object>} outdatedTokens
 * @param {'solana'|'bitcoin'} platform
 * @returns {Promise<Array<object>>} Merged price list, or `[]` when nothing new was fetched.
 */
const updatePrices = async (outdatedTokens, platform) => {
  const oldPrices = await repository.getTokensPrices(platform);
  const newPrices = await getPrices(outdatedTokens);
  if (!newPrices.length) return [];
  const updatedPrices = mergePrices(oldPrices, newPrices);
  return updatedPrices;
};

/**
 * Mutate `tokens` in place, stamping `last_updated` only for the tokens
 * present in `outdatedTokens` (avoids marking as updated when the API failed
 * or returned no data for a token).
 * @param {Array<{id: string, last_updated: string|null}>} tokens
 * @param {Array<{id: string}>} outdatedTokens
 * @returns {void}
 */
const updateLastUpdated = (tokens, outdatedTokens) => {
  tokens.forEach((token) => {
    const isOutdated = outdatedTokens.some((outdatedToken) => token.id === outdatedToken.id);
    if (isOutdated) {
      token.last_updated = new Date().toISOString();
    }
  });
};

/**
 * Merge `newPrices` into `oldPrices`, keyed by token id, refreshing
 * `price`/`last_updated` for matches and keeping every non-updated token
 * from `oldPrices` untouched.
 * @param {Array<object>|null} oldPrices
 * @param {Array<{id: string, price: object}>} newPrices
 * @returns {Array<object>} The merged price list.
 */
const mergePrices = (oldPrices, newPrices) => {
  // Check if oldPrices is null or empty
  const priceMap = new Map();

  if (oldPrices && oldPrices.length > 0) {
    oldPrices.forEach((token) => {
      priceMap.set(token.id, token);
    });
  }

  newPrices.forEach((newToken) => {
    // Check if the newToken is already in the priceMap
    if (priceMap.has(newToken.id)) {
      priceMap.set(newToken.id, {
        ...priceMap.get(newToken.id),
        price: newToken.price,
        last_updated: new Date().toISOString(),
      });
    } else {
      // If not, add the newToken to the priceMap
      priceMap.set(newToken.id, {
        ...newToken,
        last_updated: new Date().toISOString(),
      });
    }
  });

  return Array.from(priceMap.values());
};

/**
 * Fetch USD prices (+ 24h change) for `tokensToUpdate` in a single batched
 * CoinGecko request and attach each result back onto its token.
 * @param {Array<{id: string}>} tokensToUpdate
 * @returns {Promise<Array<object>>} Tokens with a `price` field attached.
 */
const getPrices = async (tokensToUpdate) => {
  const ids = tokensToUpdate.map((token) => token.id);
  const params = { vs_currencies: 'usd', include_24hr_change: true, ids: ids.join(',') };

  const { data: prices } = await http.get(PRICE_ENDPOINT, { params, timeout: 2000 });

  return tokensToUpdate.map((token) => ({
    ...token,
    price: prices[token.id],
  }));
};

const createResponse = (message) => ({
  statusCode: 200,
  body: JSON.stringify({ message }),
});
