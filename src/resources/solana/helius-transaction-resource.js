'use strict';

/**
 * Solana enriched-transaction resource.
 *
 * Transforms enriched transactions (Helius Enhanced API or Triton parser
 * output, both produce the same canonical shape) into the public API
 * payload. The legs (`inputs` / `outputs`) are the wallet's net balance
 * change per asset, read from the ledger's `accountData` through
 * `./wallet-delta`; the provider's transfers name the counterparty and its
 * type is a hint for the semantic buckets, never the source of direction
 * (spec 016).
 *
 * DESIGN NOTE — two-stage shaping, deliberate:
 * This mapper is applied INSIDE `solana-transaction-service`
 * (`buildEnhancedTransaction`), not by the controller. The service then tags
 * the result `_source: 'enriched'`, and the controller-side
 * `solana-transaction-resource` passes it through untouched (stripping the
 * internal `_source` tag). This is not accidental double shaping: the
 * service is the only layer that has the per-page enrichment context
 * (`tokenLookup`, `nftMetadataByMint`), and this mapper's signature
 * `(tx, address, tokenLookup, options)` is intentionally not
 * decorator-compatible. Moving its application to the controller would force
 * the service to return raw provider payloads plus enrichment context
 * upward — exactly what `src/services/solana/AGENTS.md` forbids. See
 * `docs/ARCHITECTURE.md` (Solana slice) for the full rationale.
 */

const {
  SEND,
  RECEIVE,
  MINT,
  BURN,
  STAKE,
  LOAN,
  INTERACTION,
  UNKNOWN,
  MEMO,
} = require('../../constants/transaction-types');
const {
  SOL_SYMBOL,
  SOL_DECIMALS,
  SOL_ADDRESS,
  SOL_NAME,
  SOL_LOGO,
} = require('../../constants/solana-constants');
const { normalizeIpfsUrl } = require('./content-urls');
const imageOverrides = require('../../services/solana/nft-image-override-service');
const { computeWalletDelta } = require('./wallet-delta');
const { isNftTokenStandard } = require('../../constants/token-standards');

/**
 * One public vocabulary whichever provider enriched the page: the local
 * parser names the token programs by program, Helius names plain SPL
 * transfers `SOLANA_PROGRAM_LIBRARY`; the wallet must not see two labels for
 * the same thing depending on which provider answered.
 */
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Minimal base58 → utf8, enough for a memo's instruction data. */
const base58ToUtf8 = (encoded) => {
  let value = 0n;
  for (const char of encoded) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of encoded) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes).toString('utf8');
};

/**
 * The note an SPL Memo instruction carries, whichever provider enriched the
 * transaction: the local parser puts the text on `memo`; Helius leaves the
 * instruction's base58 data.
 */
const extractMemo = (transaction) => {
  if (typeof transaction.memo === 'string') return transaction.memo;
  const memoIx = (transaction.instructions || []).find((ix) => ix.programId === MEMO_PROGRAM_ID);
  return memoIx && typeof memoIx.data === 'string' ? base58ToUtf8(memoIx.data) : null;
};

const PUBLIC_SOURCE_ALIASES = {
  TOKEN_PROGRAM: 'SOLANA_PROGRAM_LIBRARY',
  TOKEN_2022_PROGRAM: 'SOLANA_PROGRAM_LIBRARY',
  ASSOCIATED_TOKEN_PROGRAM: 'SOLANA_PROGRAM_LIBRARY',
};
const publicSource = (source) => PUBLIC_SOURCE_ALIASES[source] || source;

/**
 * Truncate a mint address for UI display.
 * @param {string} mint
 * @returns {string} e.g. "EPjF...EGGk"
 */
const truncateMint = (mint) => {
  if (!mint || mint.length < 8) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
};

const buildTokenLookup = (tokens) => {
  if (tokens instanceof Map) {
    return tokens;
  }

  const lookup = new Map();
  if (!Array.isArray(tokens)) {
    return lookup;
  }

  tokens.forEach((token) => {
    if (token?.address && !lookup.has(token.address)) {
      lookup.set(token.address, token);
    }
  });

  return lookup;
};

/**
 * Look up token metadata in the known-token cache.
 * @param {string} mint
 * @param {Array|Map} tokens
 * @returns {Object|undefined}
 */
const findTokenInCache = (mint, tokens) => {
  if (!tokens || !mint) return undefined;

  if (tokens instanceof Map) {
    return tokens.get(mint);
  }

  return tokens.find((t) => t.address === mint);
};

/**
 * Two upstream shapes feed this function:
 *
 *   - Helius enhanced API: `tokenAmount` is a NUMBER already formatted by
 *     decimals (e.g. `0.014832` for 14_832 raw USDC at decimals=6, or
 *     `31658.98336` for 31_658_983_360 raw at decimals=6). Convert by
 *     multiplying by 10^decimals.
 *
 *   - Triton parser: `tokenAmount` is a STRING already in raw atomic units
 *     (e.g. `"14832"`). Pass through.
 *
 * Type-based dispatch is robust to the previous heuristic's edge case where
 * a raw integer of exactly 1 with decimals > 0 was wrongly multiplied
 * (e.g. 1 raw BONK at decimals=5 became 100_000 raw).
 */
const toRawAmount = (tokenAmount, decimals) => {
  if (tokenAmount === undefined || tokenAmount === null) return '0';

  if (typeof tokenAmount === 'string') {
    return tokenAmount;
  }

  const amount = Number(tokenAmount);
  if (isNaN(amount)) return '0';

  return String(Math.round(amount * Math.pow(10, decimals || 0)));
};

const getTransfers = (transaction) => ({
  nativeTransfers: transaction.nativeTransfers || [],
  tokenTransfers: transaction.tokenTransfers || [],
});

/**
 * Maps Helius transaction-type strings to the system's transaction-type
 * buckets. Helius docs: https://www.helius.dev/docs/webhooks/transaction-types
 */
const HELIUS_TYPE_MAPPING = {
  TRANSFER: 'TRANSFER',

  TOKEN_MINT: MINT,
  MINT_NFT: MINT,
  NFT_MINT: MINT,
  COMPRESSED_NFT_MINT: MINT,

  BURN: BURN,
  BURN_NFT: BURN,
  COMPRESSED_NFT_BURN: BURN,
  COMPRESSED_NFT_TRANSFER: 'TRANSFER',

  STAKE_TOKEN: STAKE,
  UNSTAKE_TOKEN: STAKE,
  STAKE_SOL: STAKE,
  UNSTAKE_SOL: STAKE,
  CLAIM_REWARDS: STAKE,
  INIT_STAKE: STAKE,
  MERGE_STAKE: STAKE,
  SPLIT_STAKE: STAKE,
  INIT_FARM: STAKE,

  OFFER_LOAN: LOAN,
  REPAY_LOAN: LOAN,
  TAKE_LOAN: LOAN,
  FORECLOSE_LOAN: LOAN,
  LEND_FOR_NFT: LOAN,
  REQUEST_LOAN: LOAN,

  NFT_SALE: INTERACTION,
  NFT_BID: INTERACTION,
  NFT_LISTING: INTERACTION,
  NFT_CANCEL_LISTING: INTERACTION,
  NFT_BID_CANCELLED: INTERACTION,
  NFT_AUCTION_CREATED: INTERACTION,
  NFT_AUCTION_UPDATED: INTERACTION,
  NFT_AUCTION_CANCELLED: INTERACTION,
  NFT_GLOBAL_BID: INTERACTION,
  NFT_GLOBAL_BID_CANCELLED: INTERACTION,

  ADD_LIQUIDITY: INTERACTION,
  REMOVE_LIQUIDITY: INTERACTION,
  WITHDRAW_LIQUIDITY: INTERACTION,
  CREATE_POOL: INTERACTION,
  DEPOSIT: INTERACTION,
  WITHDRAW: INTERACTION,

  UNKNOWN: UNKNOWN,
  MEMO: MEMO,
};

/**
 * The provider's own word for the transaction, in the system's buckets.
 * `'TRANSFER'` is returned as is: a transfer's direction is not the
 * provider's to say — it is read off the wallet's balance change
 * (`resolveType`). Everything the table does not name is an interaction.
 * @returns {string} SEND, RECEIVE, MINT, INTERACTION, UNKNOWN, ... or 'TRANSFER'
 */
const mapProviderType = (heliusType) => HELIUS_TYPE_MAPPING[heliusType] || INTERACTION;

/**
 * A SOL leg riding beside token legs is rent, a royalty or a tip below
 * this, and folds into the transaction rather than becoming a second row:
 * two associated-token-account rents (2 × 2,039,280 lamports), so a single
 * account opened for the counterparty never shows, and three or more
 * accounts reclaimed at once do. A SOL leg that is the only asset moving is
 * always reported, whatever its size (spec 016 FR-007).
 */
const NATIVE_SIDE_LEG_MIN_LAMPORTS = 5000000n;

const absBig = (value) => (value < 0n ? -value : value);

/**
 * The other side of one asset's movement: the counterparty that received
 * the most of it from the wallet (an output) or sent the most of it to the
 * wallet (an input). Undefined when the transfers name nobody — a closed
 * account's rent has no sender.
 */
const counterpartyFor = (transaction, address, mint, direction) => {
  const isNative = mint === SOL_ADDRESS;
  const transfers = isNative
    ? (transaction.nativeTransfers || []).map((t) => ({ ...t, weight: toBigInt(t.amount) }))
    : (transaction.tokenTransfers || [])
        .filter((t) => t.mint === mint)
        .map((t) => ({ ...t, weight: toBigInt(toRawAmount(t.tokenAmount, t.decimals ?? 0)) }));
  const ownSide = direction === 'out' ? 'fromUserAccount' : 'toUserAccount';
  const otherSide = direction === 'out' ? 'toUserAccount' : 'fromUserAccount';
  const best = transfers
    .filter((t) => t[ownSide] === address && t[otherSide] && t[otherSide] !== address)
    .sort((a, b) => (a.weight < b.weight ? 1 : a.weight > b.weight ? -1 : 0))[0];
  return best ? best[otherSide] : undefined;
};

const toBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'number') return BigInt(Math.round(value));
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

/** A token leg from the delta: metadata from the transfers first, then the catalog. */
const buildTokenLeg = (transaction, tokens, mint, entry) => {
  const transfer = (transaction.tokenTransfers || []).find((t) => t.mint === mint) || {};
  const cachedToken = findTokenInCache(mint, tokens);
  const decimals = entry.decimals ?? transfer.decimals ?? cachedToken?.decimals ?? 0;
  return {
    amount: absBig(toBigInt(entry.amount)).toString(),
    decimals,
    symbol: transfer.symbol || cachedToken?.symbol || truncateMint(mint),
    name: transfer.name || cachedToken?.name,
    logo: normalizeIpfsUrl(transfer.logoURI || cachedToken?.logoURI),
    contract: mint,
  };
};

const buildNativeLeg = (lamports) => ({
  amount: absBig(lamports).toString(),
  decimals: SOL_DECIMALS,
  symbol: SOL_SYMBOL,
  name: SOL_NAME,
  logo: SOL_LOGO,
  contract: SOL_ADDRESS,
});

/**
 * One leg per asset the wallet gained or lost (spec 016 FR-003): a
 * negative net is an output, a positive net an input. The SOL leg follows
 * FR-007 when token legs ride with it.
 * @returns {{inputs: object[], outputs: object[]}} legs without counterparties
 */
const buildLegs = (transaction, address, tokens, delta) => {
  const inputs = [];
  const outputs = [];
  const place = (leg, signed) => (signed < 0n ? outputs : inputs).push(leg);

  delta.tokens.forEach((entry, mint) => {
    place(buildTokenLeg(transaction, tokens, mint, entry), toBigInt(entry.amount));
  });

  const native = toBigInt(delta.native);
  const hasTokenLegs = delta.tokens.size > 0;
  if (native !== 0n && (!hasTokenLegs || absBig(native) >= NATIVE_SIDE_LEG_MIN_LAMPORTS)) {
    place(buildNativeLeg(native), native);
  }

  return { inputs, outputs };
};

/**
 * The type, once the legs are known (spec 016 FR-004 to FR-006).
 *
 * A semantic provider type (mint, burn, stake, loan, interaction) keeps
 * precedence. A transfer or an unknown reads its direction off the legs:
 * only outputs is a send, only inputs a receive, both an interaction.
 * Nothing moved: the note when one was written, an interaction when the
 * wallet signed for it, unknown otherwise. SOL that only came back to a
 * wallet that signed the transaction — rent from its own closed accounts,
 * a refund — is not something anyone sent: an interaction, not a receive.
 */
const resolveType = (providerType, transaction, address, legs, memo) => {
  if (providerType !== 'TRANSFER' && providerType !== UNKNOWN) return providerType;
  const signed = transaction.feePayer === address;
  const { inputs, outputs } = legs;

  if (outputs.length > 0 && inputs.length === 0) return SEND;
  if (inputs.length > 0 && outputs.length === 0) {
    const onlySolBack = inputs.length === 1 && inputs[0].contract === SOL_ADDRESS && signed;
    return onlySolBack ? INTERACTION : RECEIVE;
  }
  if (inputs.length > 0 && outputs.length > 0) return INTERACTION;
  if (memo !== null) return MEMO;
  return signed ? INTERACTION : UNKNOWN;
};

/**
 * Sends and receives name their other side on the leg (`destination` /
 * `source`), the way the wallet's rows read them; an interaction's legs
 * carry none (FR-008).
 */
const attachCounterparties = (type, transaction, address, legs) => {
  if (type === SEND) {
    legs.outputs.forEach((leg) => {
      const destination = counterpartyFor(transaction, address, leg.contract, 'out');
      if (destination) leg.destination = destination;
    });
  }
  if (type === RECEIVE) {
    legs.inputs.forEach((leg) => {
      const source = counterpartyFor(transaction, address, leg.contract, 'in');
      if (source) leg.source = source;
    });
  }
  return legs;
};

/**
 * Extract the transaction fee, but only when the user is the fee payer.
 * @param {string} address - User wallet address
 * @param {Object} transaction - Enriched transaction
 * @returns {Object|undefined} { amount, decimals, symbol }
 */
const getFee = (address, transaction) => {
  const fee = transaction.fee;
  const feePayer = transaction.feePayer;

  // Only surface the fee when the user paid it
  if (feePayer === address && fee) {
    return {
      amount: fee,
      decimals: SOL_DECIMALS,
      symbol: SOL_SYMBOL,
    };
  }

  return undefined;
};

/**
 * Enriquece inputs/outputs con metadata de NFTs
 * @param {Array} items - Array de inputs u outputs
 * @param {Map} nftMetadata - Map de mint -> { name, symbol, image }
 */
const enrichWithNftMetadata = (items, nftMetadata) => {
  items.forEach((item) => {
    if (item.isNft && item.contract && nftMetadata.has(item.contract)) {
      const metadata = nftMetadata.get(item.contract);
      if (metadata.name) item.name = metadata.name;
      if (metadata.symbol) item.symbol = metadata.symbol;
      // Same precedence as the NFT list: the curated override (a mirror for
      // collections whose origin no longer serves) wins over the asset image.
      const image = imageOverrides.lookup(item.contract) || metadata.image;
      if (image) item.logo = normalizeIpfsUrl(image);
    }
  });
};

const collectNftMints = (transaction) => {
  return getTransfers(transaction)
    .tokenTransfers.filter((transfer) => isNftTokenStandard(transfer.tokenStandard))
    .map((transfer) => transfer.mint);
};

const markNftTransfers = (items, nftMints) => {
  if (nftMints.length === 0) {
    return;
  }

  const nftMintSet = new Set(nftMints);
  items.forEach((item) => {
    if (nftMintSet.has(item.contract)) {
      item.isNft = true;
      item.amount = '1';
      item.decimals = 0;
    }
  });
};

/**
 * Normalize the `instructions` array into the canonical FE shape:
 *   [{ programId, innerInstructionsCount }, ...]
 *
 * The Triton parser already emits this shape. Helius Enhanced API returns
 * `[{ accounts, data, programId, innerInstructions: [...] }, ...]`, which the
 * FE TS type does not declare — without normalization, FE consumers reading
 * `instructions[i].innerInstructionsCount` silently get `undefined` on the
 * Helius fallback path.
 */
const normalizeInstructions = (instructions) => {
  if (!Array.isArray(instructions)) return undefined;
  return instructions.map((ix) => ({
    programId: ix.programId,
    innerInstructionsCount:
      typeof ix.innerInstructionsCount === 'number'
        ? ix.innerInstructionsCount
        : (ix.innerInstructions?.length ?? 0),
  }));
};

/**
 * Transform an enriched transaction (Helius or Triton parser output) into
 * the public API payload. NFT metadata lookup is the caller's responsibility
 * — pass it via `options.nftMetadataByMint` (see solana-transaction-service).
 *
 * @param {Object} heliusTransaction - enriched tx
 * @param {string} address           - user wallet
 * @param {Array}  [tokens=[]]       - known-token cache
 * @param {Object} [options]         - { nftMetadataByMint?: Map }
 * @returns {Promise<Object>}
 */
const transformTransaction = async (heliusTransaction, address, tokens = [], options = {}) => {
  const tokenLookup = buildTokenLookup(tokens);
  const memo = extractMemo(heliusTransaction);
  const providerType = mapProviderType(heliusTransaction.type);
  const source = publicSource(heliusTransaction.source);

  // What the wallet gained or lost, per asset, from the ledger's balance
  // changes; the transfers only name the other side (spec 016).
  const delta = computeWalletDelta(heliusTransaction, address, { toRawAmount });
  const legs = buildLegs(heliusTransaction, address, tokenLookup, delta);
  const type = resolveType(providerType, heliusTransaction, address, legs, memo);
  const { inputs, outputs } = attachCounterparties(type, heliusTransaction, address, legs);

  const nftMints = collectNftMints(heliusTransaction);
  markNftTransfers([...inputs, ...outputs], nftMints);

  if (nftMints.length > 0 && options.nftMetadataByMint) {
    enrichWithNftMetadata(inputs, options.nftMetadataByMint);
    enrichWithNftMetadata(outputs, options.nftMetadataByMint);
  }

  return {
    id: heliusTransaction.signature,
    timestamp: heliusTransaction.timestamp,
    status: heliusTransaction.transactionError ? 'failed' : 'completed',
    fee: getFee(address, heliusTransaction),
    type,
    inputs,
    outputs,
    // The note of an SPL Memo instruction (null when none); the type is
    // `memo` only when nothing else moved.
    memo,

    // Provider-enriched fields forwarded to the FE
    description: heliusTransaction.description,
    source,
    events: heliusTransaction.events,
    // Original provider type — FE uses tx.heliusType.startsWith('NFT_')
    heliusType: heliusTransaction.type,

    // Parser-derived fields. Helius enriched txs already carry these; the
    // Triton parser pipeline computes them too. Forwarding the full set
    // lets the FE TransactionDetailModal light up the debug pane and the
    // confirmation status badge without an extra round-trip.
    instructions: normalizeInstructions(heliusTransaction.instructions),
    feePayer: heliusTransaction.feePayer,
    slot: heliusTransaction.slot,
    blockTime: heliusTransaction.blockTime,
    confirmationStatus: heliusTransaction.confirmationStatus,
  };
};

module.exports = transformTransaction;
/**
 * Shared helper: build a mint-address → token Map from a token array (or pass
 * a prebuilt Map through). Also consumed by solana-transaction-service so the
 * lookup semantics stay defined in one place.
 */
module.exports.buildTokenLookup = buildTokenLookup;
/**
 * Test-only export: internal pure helpers exposed for unit tests.
 * Not part of the public resource API — do not consume from application code.
 */
module.exports.__testing = {
  extractMemo,
  toRawAmount,
  mapProviderType,
  resolveType,
  buildLegs,
  counterpartyFor,
  NATIVE_SIDE_LEG_MIN_LAMPORTS,
  collectNftMints,
  markNftTransfers,
  enrichWithNftMetadata,
  normalizeInstructions,
};
