'use strict';

/**
 * Solana bare-RPC balance provider.
 *
 * `BalanceProvider` implementation backed by the network's JSON-RPC node
 * (`locals.network.config.nodeUrl` — Triton when configured). The only
 * source of Solana balances: `solana-balance-provider` decorates what this
 * returns.
 *
 * Emits items in the balance item shape `account-balance-resource` reads so the metadata enrichment, the
 * zero-amount / spam filters and `account-balance-resource` need no
 * provider-specific branch. Token items carry no `symbol`/`name` — the
 * metadata overlay fills them for known mints, and unlisted mints are
 * hidden by the default spam filter.
 */

const axios = require('axios');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const { providerCall } = require('../../infrastructure/providers/provider-client');
const { SOL_SYMBOL, SOL_DECIMALS, SOL_NAME } = require('../../constants/solana-constants');

const BLOCKCHAIN = 'solana';
const COMMITMENT = 'confirmed';
const NATIVE_NAME = SOL_NAME;

const buildNativeItem = (owner, lamports) => ({
  owner,
  blockchain: BLOCKCHAIN,
  confirmed_balance: String(lamports),
  currency: {
    symbol: SOL_SYMBOL,
    name: NATIVE_NAME,
    decimals: SOL_DECIMALS,
    type: 'native',
    asset_path: 'solana/native/sol',
  },
});

const buildTokenItem = (owner, { mint, decimals, amount }) => ({
  owner,
  blockchain: BLOCKCHAIN,
  confirmed_balance: amount.toString(),
  // No `symbol`/`name` keys: the metadata overlay
  // fills known mints, and an unknown one must not gain `null` fields.
  currency: {
    decimals,
    type: 'token',
    asset_path: `solana/mint/${mint}`,
    detail: { contract: mint },
  },
});

/**
 * Collapse parsed token accounts into one entry per mint (a wallet can hold
 * an ATA plus auxiliary accounts for the same mint; the balance is one row
 * per asset).
 *
 * @param {Array<Object>} accounts - `value` entries from `getParsedTokenAccountsByOwner`.
 * @returns {Array<{mint: string, decimals: number, amount: bigint}>}
 */
const aggregateByMint = (accounts) => {
  const byMint = new Map();
  accounts.forEach((account) => {
    const info = account?.account?.data?.parsed?.info;
    if (!info?.mint || !info.tokenAmount) return;
    const { mint, tokenAmount } = info;
    const previous = byMint.get(mint);
    const amount = BigInt(tokenAmount.amount) + (previous?.amount ?? 0n);
    byMint.set(mint, { mint, decimals: tokenAmount.decimals, amount });
  });
  return [...byMint.values()];
};

const REQUEST_TIMEOUT = 10000;

const tokenAccountsCall = (id, owner, programId) => ({
  jsonrpc: '2.0',
  id,
  method: 'getTokenAccountsByOwner',
  params: [
    owner,
    { programId: programId.toBase58() },
    { encoding: 'jsonParsed', commitment: COMMITMENT },
  ],
});

/**
 * The node answered, but not with a balance (a JSON-RPC error inside a 200:
 * node behind, method throttled). The caller cannot fix it and a retry may
 * succeed, so it is the provider being unavailable, never an empty balance.
 */
const unavailable = (rpcError) => {
  const error = new Error('The upstream provider is unavailable, please try again.');
  error.statusCode = 503;
  error.errorCode = 'upstream_unavailable';
  error.rpcError = rpcError;
  return error;
};

/**
 * `BalanceProvider#getBalance` over the bare RPC: native lamports plus every
 * SPL token account under the Token and Token-2022 programs, in one JSON-RPC
 * batch through `providerCall('triton')`, so the read gets the shared rate
 * limit, the request budget and the circuit breaker every provider call has.
 *
 * @param {string} address - Owner base58 address (validated by the route).
 * @param {any} _tokens - unused; `BalanceProvider` signature parity.
 * @param {{network: {config: {nodeUrl: string}}}} locals
 * @returns {Promise<Array<Object>>} balance items.
 * @throws {Error} the transport error unchanged, or 503 `upstream_unavailable`
 *   when the node answers any of the three calls with a JSON-RPC error.
 */
const getBalance = async (address, _tokens, locals) => {
  const batch = [
    {
      jsonrpc: '2.0',
      id: 'balance',
      method: 'getBalance',
      params: [address, { commitment: COMMITMENT }],
    },
    tokenAccountsCall('token-program', address, TOKEN_PROGRAM_ID),
    tokenAccountsCall('token-2022', address, TOKEN_2022_PROGRAM_ID),
  ];

  const { data } = await providerCall(
    'triton',
    ({ timeout, signal }) =>
      axios.post(locals.network.config.nodeUrl, batch, {
        headers: { 'Content-Type': 'application/json' },
        timeout: Math.min(REQUEST_TIMEOUT, timeout),
        signal,
      }),
    { locals, operationName: 'Solana balance' }
  );

  const byId = new Map((Array.isArray(data) ? data : []).map((entry) => [entry.id, entry]));
  const results = batch.map(({ id }) => byId.get(id));
  const failed = results.find((entry) => !entry || entry.error);
  if (failed) throw unavailable(failed?.error);

  const [lamports, classic, token2022] = results.map((entry) => entry.result);
  const accounts = [...(classic?.value ?? []), ...(token2022?.value ?? [])];

  return [
    buildNativeItem(address, lamports.value),
    ...aggregateByMint(accounts).map((token) => buildTokenItem(address, token)),
  ];
};

module.exports = { getBalance };
