'use strict';

/**
 * Bubblegum (compressed NFT) parser.
 *
 * Bubblegum is an Anchor program built by Metaplex that maintains an off-chain
 * cNFT collection inside an on-chain Merkle tree. Operations never touch SPL
 * tokens — they only mutate Merkle leaves — so cNFT activity is invisible to
 * the SPL-Token / System parsers and we have to identify it from the
 * instruction data itself.
 *
 * Two-level identification (most-precise wins):
 *
 *   1. **Anchor discriminator** — every Anchor instruction starts with the
 *      first 8 bytes of `sha256("global:<instruction_name>")`. We compute the
 *      table at module load so the discriminators are always in sync with
 *      the Bubblegum IDL — no hand-typed hex that can drift.
 *
 *   2. **Log message scan** — Anchor also emits `Program log: Instruction:
 *      <Name>` on every invoke. The orchestrator passes the raw log array
 *      through `ctx.logMessages`. When the discriminator path didn't match
 *      (e.g. Triton returned base64 instead of base58 data, or a future
 *      Bubblegum version added an op we don't have a discriminator for), we
 *      fall through to log parsing.
 *
 * Bubblegum v1 instruction set (https://developers.metaplex.com/bubblegum):
 *   create_tree, mint_v1, mint_to_collection_v1, transfer, burn, delegate,
 *   redeem, decompress_v1, compress, verify_creator, unverify_creator,
 *   verify_collection, unverify_collection, set_and_verify_collection
 *
 * If neither discriminator nor log scan classifies the op, the orchestrator
 * still has a final fallback (deriveType: hasBubblegum ⇒ COMPRESSED_NFT_TRANSFER)
 * because TRANSFER is by far the most common Bubblegum op in the wild.
 */

const crypto = require('node:crypto');

const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';

/**
 * Compute the 8-byte Anchor discriminator (`sha256("global:<name>")[:8]`,
 * hex-encoded) for a Bubblegum instruction name.
 * @param {string} instructionName - snake_case Anchor instruction name (e.g. 'mint_v1')
 * @returns {string} Hex-encoded 8-byte discriminator
 */
const anchorDiscriminator = (instructionName) =>
  crypto
    .createHash('sha256')
    .update(`global:${instructionName}`)
    .digest()
    .slice(0, 8)
    .toString('hex');

const OP = {
  MINT: 'mint',
  TRANSFER: 'transfer',
  BURN: 'burn',
  OTHER: 'other',
};

/** Discriminator hex → op (mint/transfer/burn/other). Computed once at module load. */
const DISCRIMINATORS = (() => {
  const table = {};
  const minters = ['mint_v1', 'mint_to_collection_v1'];
  const transfers = ['transfer'];
  const burns = ['burn'];
  const others = [
    'create_tree',
    'delegate',
    'redeem',
    'cancel_redeem',
    'decompress_v1',
    'compress',
    'verify_creator',
    'unverify_creator',
    'verify_collection',
    'unverify_collection',
    'set_and_verify_collection',
    'set_decompressible_state',
    'update_metadata',
  ];

  for (const name of minters) table[anchorDiscriminator(name)] = OP.MINT;
  for (const name of transfers) table[anchorDiscriminator(name)] = OP.TRANSFER;
  for (const name of burns) table[anchorDiscriminator(name)] = OP.BURN;
  for (const name of others) table[anchorDiscriminator(name)] = OP.OTHER;

  return table;
})();

// Anchor logs use TitleCase: "Program log: Instruction: MintV1"
// We normalize to the same op categories.
const LOG_NAME_TO_OP = {
  MintV1: OP.MINT,
  MintToCollectionV1: OP.MINT,
  Transfer: OP.TRANSFER,
  Burn: OP.BURN,
  // unrecognised names leave op undefined → falls through to OTHER classifier
};

// bs58 v6 (CJS build) exposes the codec under `.default`; without it,
// `bs58.decode` is undefined and the try/catch below silently misroutes
// base58 data to the base64 fallback (garbage bytes, no error).
const bs58 = require('bs58').default;

/**
 * Decode the first 8 bytes of an instruction's data payload to its
 * Anchor discriminator (hex). Tries base58 (web3 default) and base64
 * (some RPC providers return base64-encoded data).
 * @param {string|null|undefined} data - Raw instruction `data` field
 * @returns {string|null} Hex-encoded 8-byte discriminator, or `null` if undecodable
 */
const decodeDiscriminator = (data) => {
  if (!data) return null;

  // Attempt base58 first — that's what `getParsedTransaction(jsonParsed)`
  // returns for unknown programs.
  try {
    const buf = bs58.decode(data);
    if (buf.length >= 8) return Buffer.from(buf.slice(0, 8)).toString('hex');
  } catch {
    // fall through to base64
  }

  // Fallback: some RPCs / encodings emit base64.
  try {
    const buf = Buffer.from(data, 'base64');
    if (buf.length >= 8) return buf.slice(0, 8).toString('hex');
  } catch {
    return null;
  }

  return null;
};

/**
 * Set the `_hints` flag that corresponds to a classified Bubblegum op.
 * @param {object} ctx - Orchestrator context (`{ building, ... }`)
 * @param {string} op  - One of the OP.* constants
 * @returns {void}
 */
const setHintFromOp = (ctx, op) => {
  if (op === OP.MINT) ctx.building._hints.hasCnftMint = true;
  else if (op === OP.TRANSFER) ctx.building._hints.hasCnftTransfer = true;
  else if (op === OP.BURN) ctx.building._hints.hasCnftBurn = true;
  // OP.OTHER intentionally leaves no specific hint — only `hasBubblegum`
  // remains, which the orchestrator's deriveType handles as COMPRESSED_NFT_TRANSFER.
};

/**
 * Scan ctx.logMessages for `Instruction: <Name>` lines that fall under a
 * Bubblegum invoke block. We only act when the parser hasn't already classified
 * the op via discriminator.
 * @param {object} ctx - Orchestrator context (`{ building, logMessages, ... }`)
 * @returns {void}
 */
const classifyFromLogs = (ctx) => {
  const logs = ctx.logMessages || [];
  if (logs.length === 0) return;

  let inBubblegum = 0;
  for (const line of logs) {
    if (typeof line !== 'string') continue;

    if (line.startsWith(`Program ${BUBBLEGUM_PROGRAM_ID} invoke`)) {
      inBubblegum += 1;
      continue;
    }
    if (
      line.startsWith(`Program ${BUBBLEGUM_PROGRAM_ID} success`) ||
      line.startsWith(`Program ${BUBBLEGUM_PROGRAM_ID} failed`)
    ) {
      inBubblegum = Math.max(0, inBubblegum - 1);
      continue;
    }

    if (inBubblegum > 0 && line.startsWith('Program log: Instruction: ')) {
      const name = line.slice('Program log: Instruction: '.length).trim();
      const op = LOG_NAME_TO_OP[name];
      if (op) {
        setHintFromOp(ctx, op);
        return; // first match wins
      }
    }
  }
};

/**
 * Match any Bubblegum instruction. Always sets `hasBubblegum`, then tries
 * to classify the specific op via Anchor discriminator decode (Level 1)
 * and falls back to a log-message scan (Level 2). Sets one of
 * `hasCnftMint` / `hasCnftTransfer` / `hasCnftBurn` when classification
 * succeeds; otherwise only `hasBubblegum` remains set.
 * @param {object} parsedIx - Parsed (or unparsed) RPC instruction for Bubblegum
 * @param {object} ctx      - Orchestrator context (`{ building, logMessages, ... }`)
 * @returns {void}
 */
const parse = (parsedIx, ctx) => {
  ctx.building._hints.hasBubblegum = true;

  // Level 1: discriminator decode
  if (parsedIx?.data) {
    const disc = decodeDiscriminator(parsedIx.data);
    if (disc && DISCRIMINATORS[disc]) {
      setHintFromOp(ctx, DISCRIMINATORS[disc]);
      return;
    }
  }

  // Level 2: scan log messages for Anchor's instruction name emission. This
  // catches future Bubblegum versions and any encoding edge cases.
  classifyFromLogs(ctx);
};

module.exports = {
  programIds: [BUBBLEGUM_PROGRAM_ID],
  parse,
  // Exposed for tests
  __testing: {
    DISCRIMINATORS,
    LOG_NAME_TO_OP,
    anchorDiscriminator,
  },
};
