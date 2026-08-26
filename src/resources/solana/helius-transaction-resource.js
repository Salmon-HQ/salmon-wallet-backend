'use strict';

/**
 * Solana enriched-transaction resource.
 *
 * Transforms enriched transactions (Helius Enhanced API or Triton parser
 * output, both produce the same canonical shape) into the public API
 * payload, mapping provider type strings to the system's transaction types
 * and pivoting transfers by the user wallet into inputs / outputs.
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
  SWAP,
  MINT,
  BURN,
  STAKE,
  LOAN,
  INTERACTION,
  UNKNOWN,
} = require('../../constants/transaction-types');
const {
  SOL_SYMBOL,
  SOL_DECIMALS,
  SOL_ADDRESS,
  SOL_NAME,
  SOL_LOGO,
} = require('../../constants/solana-constants');
const {
  JUPITER_PROGRAM_IDS,
  JUPITER_LIMIT_PROGRAM_IDS,
} = require('../../constants/solana-program-ids');
const { normalizeIpfsUrl } = require('./content-urls');

const JUPITER_ALL_IDS = new Set([...JUPITER_PROGRAM_IDS, ...JUPITER_LIMIT_PROGRAM_IDS]);

/**
 * True if the transaction touches any Jupiter program (aggregator router or
 * Limit Order v2). Jupiter Ultra executes from its own escrow accounts, so
 * the user never appears in `tokenTransfers` — programId detection is the
 * only reliable signal.
 */
const hasJupiterProgram = (transaction) => {
  const instructions = transaction.instructions || [];
  return instructions.some((ix) => JUPITER_ALL_IDS.has(ix.programId));
};

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

/**
 * Group items (inputs/outputs) by contract/mint and sum their amounts.
 * Used to consolidate multiple transfers of the same token in a single tx.
 * @param {Array} items
 * @returns {Array}
 */
const groupByToken = (items) => {
  const grouped = new Map();

  items.forEach((item) => {
    const key = item.contract;
    if (grouped.has(key)) {
      const existing = grouped.get(key);
      // Sumar amounts (ambos son strings de raw amounts)
      const totalAmount = BigInt(existing.amount) + BigInt(item.amount);
      existing.amount = totalAmount.toString();
    } else {
      grouped.set(key, { ...item });
    }
  });

  return Array.from(grouped.values());
};

const buildTokenItem = (transfer, tokens, directionField, directionValue) => {
  const cachedToken = findTokenInCache(transfer.mint, tokens);
  const decimals = transfer.decimals ?? cachedToken?.decimals ?? 0;

  return {
    amount: toRawAmount(transfer.tokenAmount, decimals),
    decimals,
    symbol: transfer.symbol || cachedToken?.symbol || truncateMint(transfer.mint),
    name: transfer.name || cachedToken?.name,
    logo: normalizeIpfsUrl(transfer.logoURI || cachedToken?.logoURI),
    contract: transfer.mint,
    [directionField]: directionValue,
  };
};

const buildNativeItem = (transfer, directionField, directionValue) => ({
  amount: transfer.amount?.toString(),
  decimals: SOL_DECIMALS,
  symbol: SOL_SYMBOL,
  name: SOL_NAME,
  logo: SOL_LOGO,
  contract: SOL_ADDRESS,
  [directionField]: directionValue,
});

const getTransfers = (transaction) => ({
  nativeTransfers: transaction.nativeTransfers || [],
  tokenTransfers: transaction.tokenTransfers || [],
});

const getDirectionalTransfers = (transfers, address) => ({
  incomingTokens: transfers.tokenTransfers.filter((transfer) => transfer.toUserAccount === address),
  outgoingTokens: transfers.tokenTransfers.filter(
    (transfer) => transfer.fromUserAccount === address
  ),
  incomingNative: transfers.nativeTransfers.filter(
    (transfer) => transfer.toUserAccount === address
  ),
  outgoingNative: transfers.nativeTransfers.filter(
    (transfer) => transfer.fromUserAccount === address
  ),
});

/**
 * Maps Helius transaction-type strings to the system's transaction-type
 * buckets. Helius docs: https://www.helius.dev/docs/webhooks/transaction-types
 */
const HELIUS_TYPE_MAPPING = {
  TRANSFER: 'TRANSFER',
  SWAP: SWAP,

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
};

/**
 * Single-pass collection of incoming/outgoing mint sets for the user.
 * SOL natives normalize to `SOL_ADDRESS` so SPL ↔ SOL swaps register as
 * "different tokens" too.
 */
const collectMintSets = (address, nativeTransfers, tokenTransfers) => {
  const outgoing = new Set();
  const incoming = new Set();
  for (const t of tokenTransfers) {
    if (t.fromUserAccount === address) outgoing.add(t.mint);
    if (t.toUserAccount === address) incoming.add(t.mint);
  }
  for (const t of nativeTransfers) {
    if (t.fromUserAccount === address) outgoing.add(SOL_ADDRESS);
    if (t.toUserAccount === address) incoming.add(SOL_ADDRESS);
  }
  return { outgoing, incoming };
};

const hasMintAsymmetry = (outgoing, incoming) => {
  if (outgoing.size === 0 || incoming.size === 0) return false;
  for (const m of outgoing) if (!incoming.has(m)) return true;
  for (const m of incoming) if (!outgoing.has(m)) return true;
  return false;
};

/**
 * Pure-direction inference for TRANSFER and unknown-type transactions:
 * `RECEIVE` / `SEND` / `INTERACTION` / undefined (no transfers seen).
 */
const inferDirectionalType = (isSender, isReceiver) => {
  if (isReceiver && !isSender) return RECEIVE;
  if (isSender && !isReceiver) return SEND;
  if (isSender && isReceiver) return INTERACTION;
  return undefined;
};

/**
 * Heuristic: when both sides of a TRANSFER touch the user but with different
 * mints (e.g. swap-by-different-mints from a non-Jupiter aggregator), classify
 * as SWAP. Returns SWAP or undefined.
 */
const inferSwapByMintMix = (address, nativeTransfers, tokenTransfers) => {
  const { outgoing, incoming } = collectMintSets(address, nativeTransfers, tokenTransfers);
  return hasMintAsymmetry(outgoing, incoming) ? SWAP : undefined;
};

/**
 * Determine the system transaction type from the provider's type string.
 * @returns {string} SEND, RECEIVE, SWAP, MINT, INTERACTION, UNKNOWN, ...
 */
const mapTransactionType = (heliusType, address, transaction) => {
  // Jupiter Ultra executes from its own escrow accounts — the user never
  // appears in transfers, so programId detection is the only reliable signal.
  if (hasJupiterProgram(transaction)) return SWAP;

  const mappedType = HELIUS_TYPE_MAPPING[heliusType] || INTERACTION;
  const { nativeTransfers, tokenTransfers } = getTransfers(transaction);

  const isReceiver = [...nativeTransfers, ...tokenTransfers].some(
    (t) => t.toUserAccount === address
  );
  const isSender = [...nativeTransfers, ...tokenTransfers].some(
    (t) => t.fromUserAccount === address
  );

  if (mappedType === 'TRANSFER') {
    const directional = inferDirectionalType(isSender, isReceiver);
    if (directional === RECEIVE || directional === SEND) return directional;

    if (isSender && isReceiver) {
      const swapByMix = inferSwapByMintMix(address, nativeTransfers, tokenTransfers);
      if (swapByMix) return swapByMix;
    }
    return SEND;
  }

  if (mappedType === UNKNOWN) {
    if (nativeTransfers.length > 0 || tokenTransfers.length > 0) {
      return inferDirectionalType(isSender, isReceiver) || UNKNOWN;
    }
    return UNKNOWN;
  }

  return mappedType;
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

const DIRECTIONS = {
  in: {
    tokensField: 'incomingTokens',
    nativeField: 'incomingNative',
    item: 'source',
    counterparty: (t) => t.fromUserAccount,
    feePayerMatch: (t, fp) => t.toUserAccount === fp,
    transferType: RECEIVE,
  },
  out: {
    tokensField: 'outgoingTokens',
    nativeField: 'outgoingNative',
    item: 'destination',
    counterparty: (t) => t.toUserAccount,
    feePayerMatch: (t, fp) => t.fromUserAccount === fp,
    transferType: SEND,
  },
};

/**
 * Build the directional list (inputs when `direction='in'`, outputs when
 * `direction='out'`). Mirrors getInputs/getOutputs in a single function.
 */
const getDirectional = (direction, type, address, transaction, tokens) => {
  const dir = DIRECTIONS[direction];
  const items = [];
  const transfers = getTransfers(transaction);
  const directional = getDirectionalTransfers(transfers, address);

  if (type === SWAP) {
    let directionalTokens = directional[dir.tokensField];
    if (directionalTokens.length === 0 && transaction.feePayer) {
      directionalTokens = transfers.tokenTransfers.filter((t) =>
        dir.feePayerMatch(t, transaction.feePayer)
      );
    }
    directionalTokens.forEach((t) => {
      items.push(buildTokenItem(t, tokens, dir.item, dir.counterparty(t)));
    });
  }

  if (type === dir.transferType) {
    directional[dir.tokensField].forEach((t) => {
      items.push(buildTokenItem(t, tokens, dir.item, dir.counterparty(t)));
    });
    directional[dir.nativeField].forEach((t) => {
      items.push(buildNativeItem(t, dir.item, dir.counterparty(t)));
    });
  }

  return type === SWAP ? groupByToken(items) : items;
};

const getInputs = (type, address, transaction, tokens) =>
  getDirectional('in', type, address, transaction, tokens);

const getOutputs = (type, address, transaction, tokens) =>
  getDirectional('out', type, address, transaction, tokens);

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
      if (metadata.image) item.logo = normalizeIpfsUrl(metadata.image);
    }
  });
};

const RATE_PRECISION_DIGITS = 6;
const RATE_PRECISION_SCALE = 10n ** BigInt(RATE_PRECISION_DIGITS);

/**
 * Decimal-aware ratio with `RATE_PRECISION_DIGITS` digits, computed in
 * BigInt to survive token amounts that exceed `Number.MAX_SAFE_INTEGER`
 * (e.g. BONK at 18 decimals where 1 BONK = 10^18 raw).
 *
 *   rate = (recv / 10^recvDec) / (sent / 10^sentDec)
 *        = (recv * 10^sentDec) / (sent * 10^recvDec)
 *
 * Returns a string with the precision baked in, or `undefined` when sent=0
 * or any input is non-numeric.
 */
const computeConversionRate = (sentRaw, sentDec, recvRaw, recvDec) => {
  let sentBig;
  let recvBig;
  try {
    sentBig = BigInt(sentRaw);
    recvBig = BigInt(recvRaw);
  } catch {
    return undefined;
  }
  if (sentBig <= 0n) return undefined;

  const sentScale = 10n ** BigInt(sentDec || 0);
  const recvScale = 10n ** BigInt(recvDec || 0);

  const numerator = recvBig * sentScale * RATE_PRECISION_SCALE;
  const denominator = sentBig * recvScale;
  const scaled = numerator / denominator;

  const intPart = scaled / RATE_PRECISION_SCALE;
  const fracPart = (scaled % RATE_PRECISION_SCALE).toString().padStart(RATE_PRECISION_DIGITS, '0');
  return `${intPart}.${fracPart}`;
};

/**
 * Build a single-hop swapRoute from the user-pivoted inputs/outputs.
 *
 * Semantics:
 *   - `outputs` are tokens the user SENT (the swap's "input from user")
 *   - `inputs` are tokens the user RECEIVED (the swap's "output to user")
 *
 * The FE `SwapRouteHop` flips the naming: hop.inputToken = what enters the
 * hop (= user sent) and hop.outputToken = what leaves the hop (= user
 * received). We honor the FE contract.
 *
 * Multi-hop detail (`innerSwaps`) is left null for now — that requires
 * walking inner instructions per-program. The single-hop view is enough to
 * unlock the SwapRoute / conversion-rate UI in the FE today.
 */
const buildSwapRoute = (inputs, outputs, source) => {
  if (!inputs || !outputs) return null;
  const sentToken = outputs[0];
  const receivedToken = inputs[0];
  if (!sentToken || !receivedToken) return null;

  const sentAmount = sentToken.amount || '0';
  const receivedAmount = receivedToken.amount || '0';

  const hop = {
    dex: source || 'UNKNOWN',
    percent: 100,
    inputToken: {
      symbol: sentToken.symbol,
      amount: sentAmount,
      decimals: sentToken.decimals,
      logo: sentToken.logo || null,
    },
    outputToken: {
      symbol: receivedToken.symbol,
      amount: receivedAmount,
      decimals: receivedToken.decimals,
      logo: receivedToken.logo || null,
    },
  };

  const rate = computeConversionRate(
    sentAmount,
    sentToken.decimals,
    receivedAmount,
    receivedToken.decimals
  );

  return {
    hops: [hop],
    inputAmount: sentAmount,
    outputAmount: receivedAmount,
    conversionRate: rate
      ? {
          fromSymbol: sentToken.symbol,
          toSymbol: receivedToken.symbol,
          rate,
        }
      : undefined,
  };
};

const collectNftMints = (transaction) => {
  return getTransfers(transaction)
    .tokenTransfers.filter(
      (transfer) =>
        transfer.tokenStandard === 'NonFungible' || transfer.tokenStandard === 'NonFungibleEdition'
    )
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
  const type = mapTransactionType(heliusTransaction.type, address, heliusTransaction);

  const inputs = getInputs(type, address, heliusTransaction, tokenLookup);
  const outputs = getOutputs(type, address, heliusTransaction, tokenLookup);

  const nftMints = collectNftMints(heliusTransaction);
  markNftTransfers([...inputs, ...outputs], nftMints);

  if (nftMints.length > 0 && options.nftMetadataByMint) {
    enrichWithNftMetadata(inputs, options.nftMetadataByMint);
    enrichWithNftMetadata(outputs, options.nftMetadataByMint);
  }

  // Populate swapRoute when this is a swap so the FE's SwapRoute /
  // ConversionRate UI lights up. Works for both Helius- and Triton-parsed
  // transactions because both paths feed the same canonical inputs/outputs.
  const swapRoute =
    type === SWAP ? buildSwapRoute(inputs, outputs, heliusTransaction.source) : undefined;

  return {
    id: heliusTransaction.signature,
    timestamp: heliusTransaction.timestamp,
    status: heliusTransaction.transactionError ? 'failed' : 'completed',
    fee: getFee(address, heliusTransaction),
    type,
    inputs,
    outputs,

    // Provider-enriched fields forwarded to the FE
    description: heliusTransaction.description,
    source: heliusTransaction.source,
    events: heliusTransaction.events,
    // Original provider type — FE uses tx.heliusType.startsWith('NFT_')
    heliusType: heliusTransaction.type,
    swapRoute,

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
  buildSwapRoute,
  toRawAmount,
  computeConversionRate,
  mapTransactionType,
  inferDirectionalType,
  inferSwapByMintMix,
  collectMintSets,
  hasMintAsymmetry,
  collectNftMints,
  markNftTransfers,
  enrichWithNftMetadata,
  normalizeInstructions,
};
