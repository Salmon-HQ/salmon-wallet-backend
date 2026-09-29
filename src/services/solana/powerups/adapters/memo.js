'use strict';

/**
 * `memo` — the reference transaction-building Powerup.
 *
 * One instruction to the SPL Memo program carrying the caller's note. It
 * moves no funds and touches no account but the caller's signature, which
 * makes it the cheapest real transaction the generic build path can
 * produce: the client exercises the whole flow (params → 400, unsigned
 * bytes → sign → broadcast, forced 422/502) against something that costs
 * only the network fee. Enabled on the `local` stage only (see
 * `network-capabilities-local.js`); whether it ships is the owner's call.
 */

const { PublicKey, TransactionInstruction } = require('@solana/web3.js');

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
/** Memo caps a note well below this; keep the transaction small. */
const MAX_NOTE_BYTES = 256;

/** `{ params: { note } }` or a 400 envelope (`note_too_long` is declared on the registry entry). */
const validate = (query) => {
  const note = query.note;
  if (note === undefined || note === '') {
    return { error: 'missing_parameter', error_description: 'Missing required query params: note' };
  }
  if (typeof note !== 'string') {
    return { error: 'invalid_parameter', error_description: 'note must be a string' };
  }
  if (Buffer.byteLength(note, 'utf8') > MAX_NOTE_BYTES) {
    return {
      error: 'note_too_long',
      error_description: `note must be at most ${MAX_NOTE_BYTES} bytes`,
    };
  }
  return { params: { note, publicKey: query.publicKey } };
};

/** The memo instruction, signed by the caller so the note is attributable to them. */
const build = async ({ note, publicKey }) => ({
  instructions: [
    new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM_ID),
      keys: [{ pubkey: new PublicKey(publicKey), isSigner: true, isWritable: false }],
      data: Buffer.from(note, 'utf8'),
    }),
  ],
  provider: { id: 'memo', displayName: 'SPL Memo', attribution: null },
  display: { note, noteBytes: Buffer.byteLength(note, 'utf8') },
});

module.exports = { validate, build, MEMO_PROGRAM_ID, MAX_NOTE_BYTES };
