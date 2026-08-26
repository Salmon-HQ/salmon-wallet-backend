'use strict';

/**
 * SPL Token + Token-2022 parser. The two programs use identical instruction
 * shapes for the surface we need (transfer/transferChecked/mintTo/burn) so
 * one parser handles both — we just register both program IDs.
 *
 * Web3's parser returns Token instructions as:
 *
 *   { parsed: { type: 'transfer'|'transferChecked'|'mintTo'|'mintToChecked'|
 *                      'burn'|'burnChecked'|'closeAccount',
 *               info: { source, destination, authority, mint, amount,
 *                       tokenAmount: { amount, decimals, uiAmount, ... } } },
 *     program: 'spl-token',
 *     programId: '...' }
 *
 * We push transfers into `ctx.building.tokenTransfers` in the canonical shape
 * the resource decorator expects. Mints/burns set type hints. Account
 * creates, freezes, etc. are recorded but otherwise ignored — the resource
 * decorator does the bucket mapping.
 *
 * Token-2022 NFT detection (decimals=0 + amount=1) is left to downstream
 * (see helius-transaction-resource `markNftTransfers`); the parser only
 * passes through the `tokenStandard` hint when the RPC reports it.
 */

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const TRANSFER_TYPES = new Set(['transfer', 'transferChecked']);
const MINT_TYPES = new Set(['mintTo', 'mintToChecked']);
const BURN_TYPES = new Set(['burn', 'burnChecked']);

/**
 * Normalize the amount/decimals pair out of a parsed Token instruction's
 * `info` — checked variants report `tokenAmount`, unchecked variants report
 * a bare `amount` (+ optional `decimals`).
 * @param {object} info - `parsedIx.parsed.info`
 * @returns {{amount: string, decimals: number}}
 */
const extractAmount = (info) => {
  if (info.tokenAmount) {
    return {
      amount: info.tokenAmount.amount,
      decimals: info.tokenAmount.decimals ?? 0,
    };
  }
  if (info.amount !== undefined) {
    return {
      amount: String(info.amount),
      decimals: info.decimals ?? 0,
    };
  }
  return { amount: '0', decimals: 0 };
};

/**
 * Heuristic token-standard classification: decimals=0 + amount=1 reads as
 * an NFT-shaped transfer (Token-2022 NFTs use this pattern); everything
 * else is treated as Fungible. Actual NFT confirmation happens downstream.
 * @param {{amount: string|number, decimals: number}} args
 * @returns {'NonFungible'|'Fungible'}
 */
const buildTokenStandard = ({ amount, decimals }) => {
  if (decimals === 0 && (amount === '1' || amount === 1)) {
    return 'NonFungible';
  }
  return 'Fungible';
};

/**
 * Single shape for every token-transfer push the parser emits. Keeps the
 * three op branches (transfer / mintTo / burn) honest — each just supplies
 * the directional fields and an optional internal marker (`_mintEvent`,
 * `_burnEvent`); amount, decimals, and tokenStandard are derived once.
 * @param {object} ctx    - Orchestrator context (`{ building, ... }`)
 * @param {object} fields - Directional fields + amount/decimals + optional
 *   `_mintEvent`/`_burnEvent` marker; pushed onto `ctx.building.tokenTransfers`
 * @returns {void}
 */
const pushTokenTransfer = (ctx, fields) => {
  const { amount, decimals } = fields;
  ctx.building.tokenTransfers.push({
    fromUserAccount: fields.fromUserAccount ?? null,
    toUserAccount: fields.toUserAccount ?? null,
    fromTokenAccount: fields.fromTokenAccount ?? null,
    toTokenAccount: fields.toTokenAccount ?? null,
    mint: fields.mint ?? null,
    tokenAmount: amount,
    decimals,
    tokenStandard: buildTokenStandard({ amount, decimals }),
    ...(fields._mintEvent ? { _mintEvent: true } : null),
    ...(fields._burnEvent ? { _burnEvent: true } : null),
  });
};

/**
 * Match SPL Token / Token-2022 `transfer(Checked)`, `mintTo(Checked)`, and
 * `burn(Checked)` instructions, pushing a token transfer onto
 * `ctx.building.tokenTransfers` and setting `hasMint`/`hasBurn` hints where
 * relevant. Other instruction types (account creation, freeze, etc.) are
 * no-ops here.
 * @param {object} parsedIx - Parsed RPC instruction for SPL Token / Token-2022
 * @param {object} ctx      - Orchestrator context (`{ building, tokenAccountOwners, tokenAccountMints, ... }`)
 * @returns {void}
 */
const parse = (parsedIx, ctx, _opts = {}) => {
  const parsed = parsedIx?.parsed;
  if (!parsed?.type) return;

  const info = parsed.info || {};

  if (TRANSFER_TYPES.has(parsed.type)) {
    if (!info.mint && !info.source) return;
    const { amount, decimals } = extractAmount(info);
    pushTokenTransfer(ctx, {
      fromUserAccount: info.authority || info.multisigAuthority,
      toUserAccount: info.destination ? ctx.tokenAccountOwners.get(info.destination) : null,
      fromTokenAccount: info.source,
      toTokenAccount: info.destination,
      mint: info.mint || ctx.tokenAccountMints.get(info.source),
      amount,
      decimals,
    });
    return;
  }

  if (MINT_TYPES.has(parsed.type)) {
    ctx.building._hints.hasMint = true;
    const { amount, decimals } = extractAmount(info);
    // mintTo emits a token transfer from "mint authority" to a token account.
    // Treat as an incoming token movement so the resource decorator can fill
    // inputs[] when the recipient matches the user.
    pushTokenTransfer(ctx, {
      fromUserAccount: null,
      toUserAccount: info.account ? ctx.tokenAccountOwners.get(info.account) : null,
      fromTokenAccount: null,
      toTokenAccount: info.account,
      mint: info.mint || ctx.tokenAccountMints.get(info.account),
      amount,
      decimals,
      _mintEvent: true,
    });
    return;
  }

  if (BURN_TYPES.has(parsed.type)) {
    ctx.building._hints.hasBurn = true;
    const { amount, decimals } = extractAmount(info);
    pushTokenTransfer(ctx, {
      fromUserAccount: info.authority,
      toUserAccount: null,
      fromTokenAccount: info.account,
      toTokenAccount: null,
      mint: info.mint || ctx.tokenAccountMints.get(info.account),
      amount,
      decimals,
      _burnEvent: true,
    });
  }
};

module.exports = {
  programIds: [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID],
  parse,
};
