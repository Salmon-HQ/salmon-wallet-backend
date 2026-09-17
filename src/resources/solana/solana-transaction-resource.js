'use strict';

const { SEND, RECEIVE, INTERACTION, UNKNOWN, MINT } = require('../../constants/transaction-types');
const {
  SOL_NAME,
  SOL_SYMBOL,
  SOL_DECIMALS,
  SOL_ADDRESS,
  SOL_LOGO,
} = require('../../constants/solana-constants');
const { BUBBLEGUM_PROGRAM_ID } = require('../../constants/solana-program-ids');
const { normalizeIpfsUrl } = require('./content-urls');
const { computeRpcWalletDelta } = require('./wallet-delta');
const imageOverrides = require('../../services/solana/nft-image-override-service');

/**
 * FR-007 of spec 016, the same number the enriched mapper uses: SOL that
 * rides with a token leg is a side effect (rent, wrapped SOL dust) unless it
 * is at least this much.
 */
const NATIVE_SIDE_LEG_MIN_LAMPORTS = 5000000n;

const toBigInt = (value) => {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
};
const absBig = (value) => (value < 0n ? -value : value);
const truncateMint = (mint) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Base58 keys in message order; the parsed result carries them as PublicKeys or strings. */
const accountKeysOf = (transaction) =>
  (transaction?.message?.accountKeys || []).map(({ pubkey }) =>
    typeof pubkey === 'string' ? pubkey : pubkey?.toBase58?.()
  );

/** Returns the SOL fee object when `address` is the fee payer (first key), else `undefined`. */
const getFee = (address, meta, accountKeys) => {
  if (meta?.fee && accountKeys[0] === address) {
    return { amount: meta.fee, decimals: SOL_DECIMALS, symbol: SOL_SYMBOL };
  }
  return undefined;
};

/** Returns the source pubkey from the first transfer-style instruction. */
const getSource = (transaction) => {
  const { instructions } = transaction?.message || {};
  return (
    instructions?.[0]?.parsed?.info?.authority ||
    instructions?.[0]?.parsed?.info?.source ||
    instructions?.[1]?.parsed?.info?.source
  );
};

/** Returns the destination pubkey of the first transfer instruction (or first instruction with a destination). */
const getDestination = (transaction) => {
  const { instructions } = transaction?.message || {};
  return [
    instructions?.filter((ins) => ins?.parsed?.type === 'transfer')?.[0],
    instructions?.[0],
    instructions?.[1],
    instructions?.[2],
  ]
    .map((instruction) => instruction?.parsed?.info?.destination)
    .filter(Boolean)?.[0];
};

/** Strips the internal `_source` flag from an already-enriched tx payload before returning. */
const cleanHeliusTransaction = (transactionInfo) => {
  const cleanTransaction = { ...transactionInfo };
  delete cleanTransaction._source;
  return cleanTransaction;
};

/**
 * Returns the preloaded NFT for this tx (if any) from
 * `context.locals.rpcNftBySignature` — populated by the service-layer
 * `solana-rpc-enrichment` loader. Only NFTs with collection metadata count.
 */
const getNft = (signature, context) => {
  const nft = context.locals.rpcNftBySignature?.[signature];
  return nft?.json?.collection ? nft : undefined;
};

const buildNftLeg = (nft) => ({
  amount: 1,
  decimals: 0,
  symbol: nft.symbol,
  name: nft.json.collection?.name,
  logo: normalizeIpfsUrl(imageOverrides.lookup(nft.mint?.address?.toBase58()) || nft.json.image),
  contract: nft.mint?.address?.toBase58(),
});

const buildNativeLeg = (lamports) => ({
  amount: absBig(lamports).toString(),
  decimals: SOL_DECIMALS,
  symbol: SOL_SYMBOL,
  name: SOL_NAME,
  logo: SOL_LOGO,
  contract: SOL_ADDRESS,
});

/** A token leg from the token list the enrichment preloaded, or the bare mint when the list does not know it. */
const buildTokenLeg = (mint, entry, nft, tokens) => {
  if (nft && nft.mint?.address?.toBase58() === mint) return buildNftLeg(nft);
  const token = (tokens || []).find((candidate) => candidate.address === mint);
  return {
    amount: absBig(toBigInt(entry.amount)).toString(),
    decimals: entry.decimals ?? token?.decimals ?? 0,
    symbol: token?.symbol || truncateMint(mint),
    name: token?.name,
    logo: normalizeIpfsUrl(token?.logoURI),
    contract: mint,
  };
};

/**
 * One leg per asset the wallet gained or lost (spec 016 FR-003), read off
 * the ledger's pre/post balances rather than off the instructions: a
 * negative net is an output, a positive net an input. The SOL leg follows
 * FR-007 when token legs ride with it.
 */
const buildLegs = (delta, nft, tokens) => {
  const inputs = [];
  const outputs = [];
  const place = (leg, signed) => (signed < 0n ? outputs : inputs).push(leg);

  delta.tokens.forEach((entry, mint) => {
    place(buildTokenLeg(mint, entry, nft, tokens), toBigInt(entry.amount));
  });

  const native = toBigInt(delta.native);
  const hasTokenLegs = delta.tokens.size > 0;
  if (native !== 0n && (!hasTokenLegs || absBig(native) >= NATIVE_SIDE_LEG_MIN_LAMPORTS)) {
    place(buildNativeLeg(native), native);
  }

  return { inputs, outputs };
};

/**
 * The type, once the legs are known (spec 016 FR-004 to FR-006): a Bubblegum
 * mint keeps precedence; then only outputs is a send, only inputs a receive,
 * both an interaction; nothing moved is an interaction when the wallet paid
 * the fee (it signed for something) and unknown otherwise.
 */
const resolveType = (meta, legs, isFeePayer) => {
  const logMessages = meta?.logMessages || [];
  if (logMessages.some((msg) => msg.includes(BUBBLEGUM_PROGRAM_ID))) return MINT;
  const hasIn = legs.inputs.length > 0;
  const hasOut = legs.outputs.length > 0;
  if (hasIn && hasOut) return INTERACTION;
  if (hasOut) return SEND;
  if (hasIn) return RECEIVE;
  return isFeePayer ? INTERACTION : UNKNOWN;
};

/** Counterparties from the instruction heuristics: who the inputs came from, where the outputs went. */
const attachCounterparties = (type, legs, transaction) => {
  const source = getSource(transaction);
  const destination = getDestination(transaction);
  return {
    inputs: legs.inputs.map((leg) => (type === RECEIVE && source ? { ...leg, source } : leg)),
    outputs: legs.outputs.map((leg) =>
      type === SEND && destination ? { ...leg, destination } : leg
    ),
  };
};

/** Assembles the bare-RPC fallback resource: id, timestamp, status, fee, type, inputs, outputs. */
const buildResource = (transactionInfo, context) => {
  const { address, signature, blockTime, meta, transaction } = transactionInfo;
  const accountKeys = accountKeysOf(transaction);
  const delta = computeRpcWalletDelta(meta, accountKeys, address);
  const nft = getNft(signature, context);
  const legs = buildLegs(delta, nft, context.locals.tokens);
  const type = resolveType(meta, legs, accountKeys[0] === address);
  const { inputs, outputs } = attachCounterparties(type, legs, transaction);

  return {
    id: signature,
    timestamp: blockTime,
    status: meta?.err ? 'failed' : 'completed',
    fee: getFee(address, meta, accountKeys),
    type,
    inputs,
    outputs,
  };
};

/**
 * Solana transaction resource — top-level dispatcher for a single tx.
 *
 * When `transactionInfo._source === 'enriched'` (Triton-parsed or Helius
 * Enhanced API, already normalized upstream via `buildEnhancedTransaction`),
 * strips the internal `_source` marker and returns the payload as-is.
 * Otherwise builds the bare-RPC fallback shape via `buildResource`: the
 * legs are the wallet's net balance change per asset (spec 016), read off
 * the parsed result's pre/post balances — the same rule the enriched mapper
 * applies to the ledger — never a guess from the first transfer instruction.
 *
 * Pure mapper: performs no I/O. The lookup data it reads —
 * `locals.tokens`, `locals.rpcNftBySignature` — is preloaded by
 * `src/services/solana/solana-rpc-enrichment.js` before the controller
 * decorates the payload.
 *
 * DESIGN NOTE — two-stage shaping, deliberate:
 * Enriched transactions are already shaped inside the service by
 * `helius-transaction-resource` (the canonical enriched mapper, which needs
 * the service's per-page enrichment context); this resource only strips the
 * internal `_source` tag from them. Bare-RPC transactions are shaped here,
 * at the controller layer. The `_source` discriminator is the seam between
 * the two paths. Do not merge the two mappers or move the enriched shaping
 * to the controller — see the design note in `helius-transaction-resource.js`
 * and `docs/ARCHITECTURE.md` (Solana slice).
 *
 * @param {Object} transactionInfo - Either an already-enriched tx payload
 *   (`_source: 'enriched'`) or a bare-RPC `{ address, signature, blockTime,
 *   meta, transaction }` record.
 * @param {Object} include - relation include map
 * @param {string} key - decorator chain key
 * @param {Object} context - per-request context (`locals.tokens` /
 *   `locals.rpcNftBySignature` are read here for the bare-RPC path)
 * @returns {Promise<Object>} resource - enriched passthrough, or the
 *   bare-RPC shape `{ id, timestamp, status, fee, type, inputs, outputs }`
 *   built by `buildResource`
 */
module.exports = async (transactionInfo, include, key, context) => {
  const { _source } = transactionInfo;

  // 'enriched' covers both Triton-parsed (current primary) and Helius
  // Enhanced API (fallback) — both flow through buildEnhancedTransaction in
  // the service layer.
  if (_source === 'enriched') {
    return cleanHeliusTransaction(transactionInfo);
  }

  return buildResource(transactionInfo, context);
};
