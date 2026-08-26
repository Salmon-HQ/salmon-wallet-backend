'use strict';

/**
 * CoinGecko service.
 *
 * All upstream calls go through `getCachedOrFetch`:
 *   short-term cache hit → return,
 *   miss → fetch + save short-term,
 *   fetch error → fall back to a long-term cache entry if any.
 *
 * Quirks:
 *   - Free-tier history is capped at `MAX_DAYS_FREE_TIER = 365`.
 *   - `days: 'ytd'` resolves to a fresh "days since Jan 1" count per call.
 *   - `getExchangeRates` re-bases CoinGecko's BTC-denominated rates onto USD.
 */

const http = require('axios');
const repository = require('../../repositories/shared/coingecko-repository');
const {
  withRetry,
  rateLimiter,
} = require('../../infrastructure/rate-limiting/coingecko-rate-limiter');

const BASE_ENDPOINT = 'https://api.coingecko.com';
const MARKET_CHART_ENDPOINT = `${BASE_ENDPOINT}/api/v3/coins`;
const EXCHANGE_RATES_ENDPOINT = `${BASE_ENDPOINT}/api/v3/exchange_rates`;
const SUPPORTED_FIAT_CURRENCIES = [
  'usd',
  'eur',
  'gbp',
  'jpy',
  'cny',
  'krw',
  'inr',
  'cad',
  'aud',
  'brl',
  'mxn',
  'chf',
  'sgd',
  'hkd',
  'try',
];

const fetchFromCoinGecko = async (url, params, timeout, operationName) => {
  await rateLimiter.waitAndConsume();

  const { data } = await withRetry(async () => http.get(url, { params, timeout }), {
    operationName,
  });

  return data;
};

const withLongTermFallback = async (loadLongTerm, error, message) => {
  const cached = await loadLongTerm();
  if (cached) {
    console.warn(message, error);
    return cached;
  }
  throw error;
};

const normalizeHistoryDays = (rawDays) => {
  if (rawDays === 'ytd') {
    return calculateYTDDays();
  }

  if (rawDays === 'max') {
    return MAX_DAYS_FREE_TIER;
  }

  // A numeric window past the free-tier limit is answered by CoinGecko with
  // 401 (it is a paid feature), which reached the client as 500 server_error.
  // Clamp instead: the caller asked for "as much history as possible" and the
  // free tier's maximum is exactly that. Non-numeric values pass through so
  // CoinGecko still emits its own 400 for genuine garbage.
  const parsed = Number(rawDays);
  if (Number.isFinite(parsed) && parsed > MAX_DAYS_FREE_TIER) {
    return MAX_DAYS_FREE_TIER;
  }

  return rawDays;
};

const mapCoinInfo = (data, currency) => ({
  id: data.id,
  symbol: data.symbol,
  name: data.name,
  image: data.image?.large || data.image?.small,
  description: data.description?.en || '',
  links: {
    homepage: data.links?.homepage?.[0],
    twitter: data.links?.twitter_screen_name
      ? `https://twitter.com/${data.links.twitter_screen_name}`
      : null,
  },
  marketData: {
    currentPrice: data.market_data?.current_price?.[currency] || 0,
    priceChange24h: data.market_data?.price_change_24h || 0,
    priceChangePercentage24h: data.market_data?.price_change_percentage_24h || 0,
    marketCap: data.market_data?.market_cap?.[currency] || 0,
    marketCapRank: data.market_data?.market_cap_rank || null,
    totalVolume: data.market_data?.total_volume?.[currency] || 0,
    high24h: data.market_data?.high_24h?.[currency] || 0,
    low24h: data.market_data?.low_24h?.[currency] || 0,
    circulatingSupply: data.market_data?.circulating_supply || 0,
    totalSupply: data.market_data?.total_supply || 0,
    maxSupply: data.market_data?.max_supply || null,
    ath: data.market_data?.ath?.[currency] || 0,
    athChangePercentage: data.market_data?.ath_change_percentage?.[currency] || 0,
    athDate: data.market_data?.ath_date?.[currency] || null,
    atl: data.market_data?.atl?.[currency] || 0,
    atlChangePercentage: data.market_data?.atl_change_percentage?.[currency] || 0,
    atlDate: data.market_data?.atl_date?.[currency] || null,
  },
});

const normalizeExchangeRates = (data) => {
  const sourceRates = data?.rates || {};
  const usdValue = sourceRates.usd?.value;

  if (!usdValue) {
    throw new Error('CoinGecko exchange_rates response missing USD base rate');
  }

  const rates = SUPPORTED_FIAT_CURRENCIES.reduce((acc, code) => {
    const value = sourceRates[code]?.value;
    if (value) {
      acc[code] = code === 'usd' ? 1 : value / usdValue;
    }
    return acc;
  }, {});

  rates.usd = 1;

  return {
    base: 'usd',
    timestamp: Math.floor(Date.now() / 1000),
    rates,
  };
};

const getCachedOrFetch = async ({
  loadShortTerm,
  fetchAndMap,
  save,
  loadLongTerm,
  fallbackMessage,
}) => {
  const cached = await loadShortTerm();
  if (cached) {
    return cached;
  }

  try {
    const data = await fetchAndMap();
    await save(data);
    return data;
  } catch (error) {
    return withLongTermFallback(loadLongTerm, error, fallbackMessage);
  }
};

const calculateYTDDays = () => {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return Math.ceil((now - startOfYear) / (1000 * 60 * 60 * 24));
};

// Free tier CoinGecko limits
const MAX_DAYS_FREE_TIER = 365;

/**
 * Fetch a coin's market chart (prices, market caps, volumes).
 * `days` accepts `'ytd'` (days since Jan 1), `'max'` (capped at
 * `MAX_DAYS_FREE_TIER`), or a numeric day count.
 * @param {{coinId: string, days?: ('ytd'|'max'|number), currency?: string}} params
 * @param {Object} locals
 * @returns {Promise<{coinId: string, currency: string, days: ('ytd'|'max'|number), prices: Array, marketCaps: Array, totalVolumes: Array}>}
 */
const getMarketChart = async (params, locals) => {
  const { coinId, days: rawDays = 7, currency = 'usd' } = params;
  const days = normalizeHistoryDays(rawDays);
  const cacheKey = { coinId, days: rawDays, currency };

  return getCachedOrFetch({
    loadShortTerm: () => repository.getShortTermChart(cacheKey, locals),
    fetchAndMap: async () => {
      const data = await fetchFromCoinGecko(
        `${MARKET_CHART_ENDPOINT}/${coinId}/market_chart`,
        { vs_currency: currency, days },
        5000,
        `CoinGecko getMarketChart (${coinId}, ${days} days)`
      );

      return {
        coinId,
        currency,
        days: rawDays,
        prices: data.prices,
        marketCaps: data.market_caps,
        totalVolumes: data.total_volumes,
      };
    },
    save: (chartData) => repository.saveChart(cacheKey, chartData, locals),
    loadLongTerm: () => repository.getLongTermChart(cacheKey, locals),
    fallbackMessage: 'Using long-term cached chart due to:',
  });
};

/**
 * Fetch a coin's metadata + market summary, mapped to the FE shape.
 * @param {{coinId: string, currency?: string}} params
 * @param {Object} locals
 * @returns {Promise<Object>} See `mapCoinInfo` for the response shape.
 */
const getCoinInfo = async (params, locals) => {
  const { coinId, currency = 'usd' } = params;
  const cacheKey = { coinId, currency };

  return getCachedOrFetch({
    loadShortTerm: () => repository.getShortTermCoinInfo(cacheKey, locals),
    fetchAndMap: async () => {
      const data = await fetchFromCoinGecko(
        `${BASE_ENDPOINT}/api/v3/coins/${coinId}`,
        {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
        5000,
        `CoinGecko getCoinInfo (${coinId})`
      );

      return mapCoinInfo(data, currency);
    },
    save: (coinInfo) => repository.saveCoinInfo(cacheKey, coinInfo, locals),
    loadLongTerm: () => repository.getLongTermCoinInfo(cacheKey, locals),
    fallbackMessage: 'Using long-term cached coin info due to:',
  });
};

/**
 * Fetch fiat exchange rates re-based onto USD.
 *
 * If the upstream response is missing the USD base rate, the inner
 * `normalizeExchangeRates` call throws, which `getCachedOrFetch` catches and
 * falls back to the long-term cache. The function only surfaces an error when
 * no long-term cache entry is available either.
 *
 * @param {Object} locals
 * @returns {Promise<{base: 'usd', timestamp: number, rates: Object<string, number>}>}
 */
const getExchangeRates = async (locals) => {
  return getCachedOrFetch({
    loadShortTerm: () => repository.getShortTermExchangeRates(locals),
    fetchAndMap: async () => {
      const data = await fetchFromCoinGecko(
        EXCHANGE_RATES_ENDPOINT,
        {},
        2000,
        'CoinGecko exchange rates'
      );

      return normalizeExchangeRates(data);
    },
    save: (rates) => repository.saveExchangeRates(rates, locals),
    loadLongTerm: () => repository.getLongTermExchangeRates(locals),
    fallbackMessage: 'Using long-term cached exchange rates due to:',
  });
};

/**
 * Fetch a token's market chart by contract address (mint) instead of
 * CoinGecko coin id — covers any token CoinGecko lists for the platform,
 * without needing a mint→id mapping. Same `days` normalization and
 * long-term-fallback policy as `getMarketChart`.
 * @param {{platform: string, contractAddress: string, days?: ('ytd'|'max'|number), currency?: string}} params
 * @param {Object} locals
 * @returns {Promise<{platform: string, contractAddress: string, currency: string, days: ('ytd'|'max'|number), prices: Array, marketCaps: Array, totalVolumes: Array}>}
 */
const getContractMarketChart = async (params, locals) => {
  const { platform, contractAddress, days: rawDays = 7, currency = 'usd' } = params;
  const days = normalizeHistoryDays(rawDays);
  const cacheKey = { coinId: `${platform}:${contractAddress}`, days: rawDays, currency };

  return getCachedOrFetch({
    loadShortTerm: () => repository.getShortTermChart(cacheKey, locals),
    fetchAndMap: async () => {
      const data = await fetchFromCoinGecko(
        `${MARKET_CHART_ENDPOINT}/${platform}/contract/${contractAddress}/market_chart`,
        { vs_currency: currency, days },
        5000,
        `CoinGecko getContractMarketChart (${platform}:${contractAddress}, ${days} days)`
      );

      return {
        platform,
        contractAddress,
        currency,
        days: rawDays,
        prices: data.prices,
        marketCaps: data.market_caps,
        totalVolumes: data.total_volumes,
      };
    },
    save: (chartData) => repository.saveChart(cacheKey, chartData, locals),
    loadLongTerm: () => repository.getLongTermChart(cacheKey, locals),
    fallbackMessage: 'Using long-term cached contract chart due to:',
  });
};

/**
 * Fetch a token's metadata + market summary by contract address (mint)
 * instead of CoinGecko coin id — covers any token CoinGecko lists for the
 * platform, without needing a mint→id mapping. Same mapped shape as
 * `getCoinInfo` (including the resolved CoinGecko `id`, so clients can
 * cache it and switch to the coin-id paths), same short/long-term cache
 * policy, cache key namespaced by `platform:contractAddress`.
 * @param {{platform: string, contractAddress: string, currency?: string}} params
 * @param {Object} locals
 * @returns {Promise<Object>} See `mapCoinInfo` for the response shape.
 */
const getContractCoinInfo = async (params, locals) => {
  const { platform, contractAddress, currency = 'usd' } = params;
  const cacheKey = { coinId: `${platform}:${contractAddress}`, currency };

  return getCachedOrFetch({
    loadShortTerm: () => repository.getShortTermCoinInfo(cacheKey, locals),
    fetchAndMap: async () => {
      // No query params: the contract endpoint returns the full coin object
      // (market_data included) and accepts no field-selection options.
      const data = await fetchFromCoinGecko(
        `${MARKET_CHART_ENDPOINT}/${platform}/contract/${contractAddress}`,
        {},
        5000,
        `CoinGecko getContractCoinInfo (${platform}:${contractAddress})`
      );

      return mapCoinInfo(data, currency);
    },
    save: (coinInfo) => repository.saveCoinInfo(cacheKey, coinInfo, locals),
    loadLongTerm: () => repository.getLongTermCoinInfo(cacheKey, locals),
    fallbackMessage: 'Using long-term cached contract coin info due to:',
  });
};

module.exports = {
  getMarketChart,
  getContractMarketChart,
  getCoinInfo,
  getContractCoinInfo,
  getExchangeRates,
};
