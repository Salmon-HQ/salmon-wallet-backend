'use strict';

/**
 * Triton parsed-RPC → enriched-transaction orchestrator.
 *
 * Takes a `getParsedTransaction` RPC response and produces a transaction in
 * the canonical "enriched" shape (see solana-data-provider.js for the spec)
 * so the existing `helius-transaction-resource` decorator can consume it
 * unchanged.
 *
 * Pipeline:
 *
 *   raw RPC tx ──┐
 *                ▼
 *   build ctx (accountKeys, tokenAccount → owner, tokenAccount → mint)
 *                │
 *   walk top-level instructions ──► parser registry (System, SPL Token,
 *                │                  Metaplex, Bubblegum, Jupiter, Stake,
 *                │                  Staking, Lending, DEX) — each contributes
 *                │                  transfers / hints to the building shape
 *                │
 *   walk inner instructions ─► same registry
 *                │
 *   post-process pass (Jupiter swapRoute, type derivation, source pick)
 *                │
 *                ▼
 *   enriched tx ─► returned to TritonProvider
 *
 * Adding a new program parser:
 *   1. Drop a file in `./parsers/` exporting `{ programIds, parse, postProcess? }`.
 *   2. Register it in PARSERS below.
 *   3. (Optional) update program-sources.js to give the program a source name.
 *
 * The orchestrator never throws — failures degrade to UNKNOWN type rather
 * than dropping the whole tx.
 */

const { pickPrimarySource, getSource } = require('./program-sources');

const systemParser = require('./parsers/system');
const splTokenParser = require('./parsers/spl-token');
const metaplexParser = require('./parsers/metaplex');
const bubblegumParser = require('./parsers/bubblegum');
const jupiterParser = require('./parsers/jupiter');
const stakeParser = require('./parsers/stake');
const stakingParser = require('./parsers/staking');
const lendingParser = require('./parsers/lending');
const dexParser = require('./parsers/dex');

const PARSERS = [
  systemParser,
  splTokenParser,
  metaplexParser,
  bubblegumParser,
  jupiterParser,
  stakeParser,
  stakingParser,
  lendingParser,
  dexParser,
];

/**
 * Build the programId → parser lookup map from PARSERS, so dispatch is a
 * single Map.get() per instruction instead of a linear scan.
 * @returns {Map<string, object>} programId → parser module
 */
const buildRegistry = () => {
  const map = new Map();
  for (const parser of PARSERS) {
    for (const id of parser.programIds) {
      map.set(id, parser);
    }
  }
  return map;
};

const PARSER_REGISTRY = buildRegistry();

const POST_PROCESSORS = PARSERS.filter((p) => typeof p.postProcess === 'function');

/**
 * Build a tokenAccount → owner map by walking pre + post token balances.
 * The Token program transfer instructions only carry token-account addresses
 * (`source`, `destination`); we need to translate those to owner wallets.
 *
 * Pre+post balances always carry both `mint` and `owner` for every account
 * touched by the tx. They're keyed by accountIndex into accountKeys, so we
 * walk both and populate two maps.
 */
const buildAccountMaps = (rawTx) => {
  const accountKeys = rawTx?.transaction?.message?.accountKeys || [];
  const pre = rawTx?.meta?.preTokenBalances || [];
  const post = rawTx?.meta?.postTokenBalances || [];

  const tokenAccountOwners = new Map();
  const tokenAccountMints = new Map();

  for (const balance of [...pre, ...post]) {
    const idx = balance.accountIndex;
    const key = accountKeys[idx]?.pubkey || accountKeys[idx];
    if (!key) continue;
    if (balance.owner) tokenAccountOwners.set(key, balance.owner);
    if (balance.mint) tokenAccountMints.set(key, balance.mint);
  }

  return { tokenAccountOwners, tokenAccountMints };
};

/**
 * Route a single parsed instruction through source detection and the parser
 * registry, mutating `ctx.building` in place. Instructions with no matching
 * parser (and/or no known source) are silently skipped — the orchestrator
 * never throws on an unrecognized program.
 * @param {object} ix  - Parsed RPC instruction (`{ programId, parsed?, data? }`)
 * @param {object} ctx - Orchestrator context (`{ building, errors, ... }`)
 * @returns {void}
 */
const dispatchInstruction = (ix, ctx) => {
  const programId = ix?.programId;
  if (!programId) return;

  // Source detection runs first so programs known to program-sources but
  // without a dedicated parser (Wormhole, SNS, JITO_TIP, etc.) still
  // contribute to the resolved `tx.source`.
  const source = getSource(programId);
  if (source) ctx.building._sources.push(source);

  const parser = PARSER_REGISTRY.get(programId);
  if (!parser) return;
  try {
    parser.parse(ix, ctx);
  } catch (error) {
    ctx.errors.push({
      programId,
      message: error.message,
    });
  }
};

/**
 * Build the lightweight `building.instructions` list consumed by the FE
 * debug pane: one entry per top-level instruction with its programId and
 * how many inner instructions (CPIs) it triggered.
 * @param {object} rawTx - Raw `getParsedTransaction` RPC response
 * @returns {Array<{programId: string, innerInstructionsCount: number}>}
 */
const collectInstructionMetadata = (rawTx) => {
  const top = rawTx?.transaction?.message?.instructions || [];
  const innerGroups = rawTx?.meta?.innerInstructions || [];
  const countByIndex = new Map(innerGroups.map((g) => [g.index, g.instructions?.length ?? 0]));
  return top.map((ix, i) => ({
    programId: ix.programId,
    innerInstructionsCount: countByIndex.get(i) ?? 0,
  }));
};

/**
 * Hint → tx-type precedence (first match wins). Aggregator/DEX swaps share
 * a single SWAP bucket on the FE. Liquid staking buckets as STAKE_TOKEN
 * (deposit/withdraw direction comes from inputs/outputs, not the type).
 *
 * Ordering is the contract — earlier rows take priority over later rows.
 */
const TYPE_PRECEDENCE = [
  { hint: (h) => h.hasJupiter || h.hasDexSwap, type: 'SWAP' },
  { hint: (h) => h.hasCnftMint, type: 'COMPRESSED_NFT_MINT' },
  { hint: (h) => h.hasCnftBurn, type: 'COMPRESSED_NFT_BURN' },
  { hint: (h) => h.hasCnftTransfer, type: 'COMPRESSED_NFT_TRANSFER' },
  { hint: (h) => h.hasNftMint, type: 'NFT_MINT' },
  { hint: (h) => h.hasNftBurn, type: 'BURN_NFT' },
  { hint: (h) => h.hasMint, type: 'TOKEN_MINT' },
  { hint: (h) => h.hasBurn, type: 'BURN' },
  { hint: (h) => h.hasLoan, type: 'OFFER_LOAN' },
  { hint: (h) => h.hasLiquidStake, type: 'STAKE_TOKEN' },
  { hint: (h) => h.hasUnstake, type: 'UNSTAKE_TOKEN' },
  { hint: (h) => h.hasStake, type: 'STAKE_TOKEN' },
];

/**
 * Fall back to hint-derived typing when no parser set `building.type`
 * directly. Walks TYPE_PRECEDENCE in order, then falls back to TRANSFER
 * (when transfers exist), COMPRESSED_NFT_TRANSFER (Bubblegum with no
 * classified op), or UNKNOWN.
 * @param {object} building - The in-progress enriched tx (`ctx.building`)
 * @returns {string} Canonical Helius-shape type string
 */
const deriveType = (building) => {
  const h = building._hints;

  for (const row of TYPE_PRECEDENCE) {
    if (row.hint(h)) return row.type;
  }

  if (building.nativeTransfers.length > 0 || building.tokenTransfers.length > 0) {
    return 'TRANSFER';
  }

  // Bubblegum operates without SPL transfers (Merkle tree only). When the
  // discriminator decoder didn't match a known op, fall back to
  // COMPRESSED_NFT_TRANSFER — the most common Bubblegum op — so the FE
  // buckets it as a transfer-like event.
  if (h.hasBubblegum) return 'COMPRESSED_NFT_TRANSFER';

  return 'UNKNOWN';
};

/**
 * Strip the parser's internal bookkeeping (`_hints`, `_sources`, and
 * per-transfer `_mintEvent`/`_burnEvent` markers) before the enriched tx is
 * handed off to the resource layer. Mutates and returns `building`.
 * @param {object} building - The in-progress enriched tx (`ctx.building`)
 * @returns {object} The same `building` object, internal keys removed
 */
const cleanInternalKeys = (building) => {
  delete building._hints;
  delete building._sources;
  // Strip per-transfer internal markers
  for (const t of building.tokenTransfers) {
    delete t._mintEvent;
    delete t._burnEvent;
  }
  return building;
};

/**
 * Convert a raw `getParsedTransaction` response to the enriched tx shape.
 *
 * The parser is intentionally **address-agnostic**: it extracts transfers
 * with `fromUserAccount` / `toUserAccount` populated as observed on chain.
 * The downstream resource decorator (`helius-transaction-resource.js`)
 * pivots those by the wallet under inspection to build inputs / outputs.
 *
 * @param {object}  rawTx        - Solana parsed RPC tx response
 * @param {object}  [options]    - { signature?: string }
 * @returns {object|null}        - enriched tx, or null if rawTx is empty
 */
const parseTransaction = (rawTx, options = {}) => {
  if (!rawTx) return null;

  const signature = options.signature || rawTx?.transaction?.signatures?.[0] || null;

  const { tokenAccountOwners, tokenAccountMints } = buildAccountMaps(rawTx);
  const accountKeys = rawTx?.transaction?.message?.accountKeys || [];
  const feePayer = accountKeys[0]?.pubkey || accountKeys[0] || null;

  const ctx = {
    accountKeys,
    tokenAccountOwners,
    tokenAccountMints,
    // Raw program log lines — used by parsers (e.g. Bubblegum) that need to
    // identify ops Anchor logs but not the parsed-RPC decoder.
    logMessages: rawTx?.meta?.logMessages || [],
    errors: [],
    building: {
      signature,
      timestamp: rawTx?.blockTime ?? null,
      slot: rawTx?.slot ?? null,
      blockTime: rawTx?.blockTime ?? null,
      fee: rawTx?.meta?.fee ?? 0,
      feePayer,
      transactionError: rawTx?.meta?.err || null,
      type: null,
      source: null,
      description: null,
      nativeTransfers: [],
      tokenTransfers: [],
      instructions: [],
      // `events`, `swapRoute`, `innerSwaps`, `swapFees` are part of the FE
      // contract but the parser does not populate them: the resource layer
      // (helius-transaction-resource.buildSwapRoute) fills `swapRoute` from
      // inputs/outputs, and the rest are Helius-only fields the FE treats as
      // optional. We forward them as-is from the raw tx if present.
      events: {},
      swapRoute: null,
      innerSwaps: [],
      swapFees: null,
      _hints: {},
      _sources: [],
    },
  };

  // 1. Walk top-level instructions
  const topInstructions = rawTx?.transaction?.message?.instructions || [];
  for (const ix of topInstructions) {
    dispatchInstruction(ix, ctx);
  }

  // 2. Walk inner instructions (CPIs)
  const innerGroups = rawTx?.meta?.innerInstructions || [];
  for (const group of innerGroups) {
    for (const ix of group.instructions || []) {
      dispatchInstruction(ix, ctx);
    }
  }

  // 3. Instruction metadata for FE debug pane
  ctx.building.instructions = collectInstructionMetadata(rawTx);

  // 4. Post-process passes (Jupiter swapRoute, etc.)
  for (const parser of POST_PROCESSORS) {
    try {
      parser.postProcess(ctx);
    } catch (error) {
      ctx.errors.push({
        stage: 'postProcess',
        message: error.message,
      });
    }
  }

  // 5. Derive type if nothing tagged it
  if (!ctx.building.type) {
    ctx.building.type = deriveType(ctx.building);
  }

  // 6. Pick primary source
  ctx.building.source = pickPrimarySource(ctx.building._sources);

  // 7. Mirror type into heliusType for FE compat (tx.heliusType.startsWith('NFT_'))
  ctx.building.heliusType = ctx.building.type;

  return cleanInternalKeys(ctx.building);
};

module.exports = {
  parseTransaction,
  PARSER_REGISTRY,
  __testing: {
    deriveType,
    buildAccountMaps,
    collectInstructionMetadata,
  },
};
