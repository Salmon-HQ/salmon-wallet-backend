'use strict';

/**
 * SPL Memo parser: keeps the note's text on `building.memo` (first memo
 * wins) and sets the `hasMemo` hint. A transaction that moves nothing and
 * carries a memo derives to type MEMO; a memo riding a transfer stays a
 * transfer, the text just travels along.
 *
 * `jsonParsed` renders a memo instruction as `{ program: 'spl-memo', parsed: '<text>' }`.
 */

const { SOURCES } = require('../program-sources');

const parse = (parsedIx, ctx) => {
  const text = typeof parsedIx?.parsed === 'string' ? parsedIx.parsed : null;
  ctx.building._hints.hasMemo = true;
  if (text !== null && ctx.building.memo == null) {
    ctx.building.memo = text;
  }
};

module.exports = {
  programIds: SOURCES.MEMO_PROGRAM,
  parse,
};
