'use strict';

/**
 * `broken-build` — a deliberately non-compliant adapter, `local` stage only.
 *
 * It emits an instruction for a program its registry entry does not declare,
 * so the build service always refuses it with 502 `provider_program_mismatch`
 * and logs `[POWERUP_PROGRAM_MISMATCH]`. It exists so the refusal is
 * demonstrable on a device without anyone editing a working adapter, and so
 * the client's error state for a backend that rejects its own bytes has
 * something to render. Never enable it on a shipping stage.
 */

const { PublicKey, TransactionInstruction } = require('@solana/web3.js');

/** Declared in the registry entry, and deliberately not the one below. */
const DECLARED_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
// Not the compute budget: that one every build may invoke by construction.
const UNDECLARED_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const validate = (query) => ({ params: { publicKey: query.publicKey } });

const build = async ({ publicKey }) => ({
  instructions: [
    new TransactionInstruction({
      programId: new PublicKey(DECLARED_PROGRAM_ID),
      keys: [{ pubkey: new PublicKey(publicKey), isSigner: true, isWritable: false }],
      data: Buffer.from('declared', 'utf8'),
    }),
    new TransactionInstruction({
      programId: new PublicKey(UNDECLARED_PROGRAM_ID),
      keys: [],
      data: Buffer.from([0]),
    }),
  ],
  display: {},
});

module.exports = { validate, build, DECLARED_PROGRAM_ID, UNDECLARED_PROGRAM_ID };
