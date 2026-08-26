'use strict';

/**
 * Account balance resource — public response shape for
 * `GET /v1/:networkId/account/:address/balance`. Maps each
 * Blockdaemon Universal balance item into the canonical
 * `{ owner, blockchain, amount, decimals, symbol, name, type, ... }`
 * shape, branching on `currency.type` for native vs token addresses
 * and side-loading `logo` via `includeLogo` when `?include=logo`.
 *
 * Forwards the optional markers attached by chain-specific balance
 * providers and enrichers:
 *   - metadata (Solana provider, Jupiter v2): `_logo`, `_name`,
 *     `_symbol`, `_coingeckoId`, `_tags`
 *   - pricing (`multichain/price-enrichers`): `_price`, `_usdBalance`,
 *     `_priceChange24h`
 *
 * Markers override Blockdaemon defaults when present; absent markers
 * leave the response key-clean so existing consumers see the same
 * shape.
 *
 * See the `multichain-account-balance` API contract.
 */

const { SOL_ADDRESS } = require('../../constants/solana-constants');
const { includeLogo } = require('./resource-includes');

const NATIVE_ADDRESS = {
  'solana/native/sol': SOL_ADDRESS,
};

const NATIVE_COINGECKO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
};

module.exports = async (balance, include, key, context) => {
  const {
    owner,
    blockchain,
    confirmed_balance,
    currency,
    _logo,
    _name,
    _symbol,
    _coingeckoId,
    _tags,
    _price,
    _usdBalance,
    _priceChange24h,
  } = balance;

  const resource = {
    owner,
    blockchain,
    amount: confirmed_balance,
    decimals: currency.decimals,
    symbol: _symbol ?? currency.symbol,
    name: _name ?? currency.name,
    type: currency.type,
  };

  if (currency.type === 'native') {
    resource.address = NATIVE_ADDRESS[currency.asset_path] || currency.symbol.toLowerCase();
    resource.coingeckoId = NATIVE_COINGECKO_ID[currency.symbol];
  } else {
    const address = currency.detail?.contract || currency.asset_path?.split('/')?.[2];
    resource.mint = address;
    resource.address = address;
    if (_coingeckoId !== undefined && _coingeckoId !== null) {
      resource.coingeckoId = _coingeckoId;
    }
    if (Array.isArray(_tags)) {
      resource.tags = _tags;
    }
  }

  if (_price !== undefined) resource.price = _price;
  if (_usdBalance !== undefined) resource.usdBalance = _usdBalance;
  if (_priceChange24h !== undefined) resource.priceChange24h = _priceChange24h;

  if (_logo !== undefined && _logo !== null) {
    resource.logo = _logo;
  } else {
    await includeLogo(resource, include, key, context);
  }

  return resource;
};
