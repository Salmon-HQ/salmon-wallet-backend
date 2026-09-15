'use strict';

/**
 * Powerup registry — Salmon-maintained, code only (`community-powerups`
 * contract). Never loaded from a remote source or from user input.
 *
 * Contributors never touch this file: a maintainer adds the entry (and,
 * for a transaction-building Powerup, the adapter they wrote and reviewed).
 * A read-only Powerup is an entry with no adapter; the backend only lists
 * it on `/v1/networks` and can switch it off by id in the stage config.
 *
 * Entry shape:
 *   {
 *     tier: 'core' | 'community',
 *     networks: string[],                       // network ids it is declared for
 *     contributor: { name, url } | null,        // published on the build response
 *     endpoints?: string[],                     // read-only: the protocol endpoints the client calls (for the record)
 *     programIds?: string[],                    // transaction-building: every program a top-level instruction may invoke
 *     lookupTables?: string[],                  // transaction-building: every address lookup table an adapter may name
 *     errorCodes?: string[],                    // adapter-specific validation codes passed through as-is (400)
 *     providerProfile?: string,                 // the `profiles.js` row the adapter's upstream calls run under
 *     adapter?: {
 *       validate(query) → { params } | { error, error_description },   // codes: missing_parameter / invalid_parameter / one of errorCodes;
 *                                                                       // error_description reaches the client verbatim: never echo an upstream body or raw caller input
 *       build(params, { locals, connection }) → {
 *         instructions, lookupTableAddresses?,
 *         provider?: { id, displayName, attribution },               // data provider behind the build, if any
 *         display: { ...typed fields the client renders },
 *       },
 *     },
 *   }
 *
 * Adding a transaction-building Powerup is one registry entry + one adapter
 * + (if it calls a new upstream) one row in
 * `src/infrastructure/providers/profiles.js`. Adapters never read `req`;
 * every upstream call goes through `providerCall`.
 *
 * Fees: `salmonFee` is forced to null on every generic build in this
 * feature. Fee legs land with the first Powerup that has one: the fee
 * instruction is asserted present in the compiled message and an ops gap
 * (missing fee account) is logged, never a 503; the amount is never an
 * adapter-reported figure.
 */

const memo = require('./adapters/memo');
const brokenBuild = require('./adapters/broken-build');

const POWERUPS = {
  // Payments (frontend spec 033): the wallet builds a Solana Pay transfer
  // request on the device and verifies settlement from the network itself.
  // Nothing to build here: the payer's transfer is core Send. Listed so the
  // per-network switch can offer or withdraw it.
  payments: {
    tier: 'core',
    networks: ['solana-mainnet', 'solana-devnet'],
    contributor: null,
    endpoints: [],
  },
  // Reference transaction-building Powerup: one Memo instruction. Listed
  // only where a stage enables it (today: `local`).
  memo: {
    tier: 'core',
    networks: ['solana-mainnet', 'solana-devnet'],
    contributor: null,
    programIds: [memo.MEMO_PROGRAM_ID],
    lookupTables: [],
    errorCodes: ['note_too_long'],
    adapter: memo,
  },
  // FIXTURE: always refused with 502 `provider_program_mismatch` so the
  // guard is demonstrable on a device. Never enable it on a shipping stage.
  'broken-build': {
    tier: 'core',
    networks: ['solana-mainnet', 'solana-devnet'],
    contributor: null,
    programIds: [brokenBuild.DECLARED_PROGRAM_ID],
    lookupTables: [],
    adapter: brokenBuild,
  },
  // Read-only FIXTURE for the client's catalogue + disclosure test (T2 of
  // spec 015): no adapter, no relationship with the protocol named; listed
  // only where a stage enables it (today: `local`). Remove or replace with a
  // real entry when the first community Powerup lands.
  'kamino-positions': {
    tier: 'community',
    networks: ['solana-mainnet'],
    contributor: { name: 'Fixture Labs', url: 'https://example.invalid/fixture' },
    endpoints: ['https://api.kamino.finance'],
  },
};

module.exports = { POWERUPS };
