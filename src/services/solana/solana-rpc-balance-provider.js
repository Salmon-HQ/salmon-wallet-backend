'use strict';

/**
 * Solana bare-RPC balance provider.
 *
 * `BalanceProvider` implementation backed by the network's JSON-RPC node
 * (`locals.network.config.nodeUrl` — Triton when configured, else Helius).
 * Used by `solana-balance-provider` as the fallback when Blockdaemon
 * Universal times out or fails upstream.
 *
 * Emits items in Blockdaemon's shape so the Jupiter enrichment, the
 * zero-amount / spam filters and `account-balance-resource` need no
 * provider-specific branch. Token `symbol`/`name` are `null` here — the
 * Jupiter overlay fills them for listed mints, and unlisted mints are
 * hidden by the default spam filter exactly as with Blockdaemon.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const { SOL_SYMBOL, SOL_DECIMALS } = require('../../constants/solana-constants');

const BLOCKCHAIN = 'solana';
const COMMITMENT = 'confirmed';
// Blockdaemon names the native asset "Solana" (SOL_NAME is "Wrapped SOL").
const NATIVE_NAME = 'Solana';

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
  currency: {
    symbol: null,
    name: null,
    decimals,
    type: 'token',
    asset_path: `solana/mint/${mint}`,
    detail: { contract: mint },
  },
});

/**
 * Collapse parsed token accounts into one entry per mint (a wallet can hold
 * an ATA plus auxiliary accounts for the same mint; Blockdaemon presents one
 * row per asset).
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

/**
 * `BalanceProvider#getBalance` over the bare RPC: native lamports plus every
 * SPL token account under the Token and Token-2022 programs.
 *
 * @param {string} address - Owner base58 address.
 * @param {any} _tokens - unused; `BalanceProvider` signature parity.
 * @param {{network: {config: {nodeUrl: string}}}} locals
 * @returns {Promise<Array<Object>>} Blockdaemon-shaped balance items.
 */
const getBalance = async (address, _tokens, locals) => {
  const connection = new Connection(locals.network.config.nodeUrl, COMMITMENT);
  const owner = new PublicKey(address);

  const [lamports, classic, token2022] = await Promise.all([
    connection.getBalance(owner, COMMITMENT),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, COMMITMENT),
    connection.getParsedTokenAccountsByOwner(
      owner,
      { programId: TOKEN_2022_PROGRAM_ID },
      COMMITMENT
    ),
  ]);

  const accounts = [...(classic?.value ?? []), ...(token2022?.value ?? [])];

  return [
    buildNativeItem(address, lamports),
    ...aggregateByMint(accounts).map((token) => buildTokenItem(address, token)),
  ];
};

module.exports = { getBalance };
