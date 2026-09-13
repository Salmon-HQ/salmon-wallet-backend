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
 * feature. Fee legs land with the first Powerup that has one; they will
 * reuse the swap's `existingFeeAccount` + `assertFeeInstructionPresent` +
 * `[SWAP_FEE_SKIPPED]` semantics, never an adapter-reported amount.
 *
 * `swap` is listed for the catalog only: it stays on `/ft/swap/build`, so
 * `GET /powerups/swap/build` answers 404 (no adapter).
 */

const memo = require('./adapters/memo');
const transferSol = require('./adapters/transfer-sol');
const brokenBuild = require('./adapters/broken-build');

const POWERUPS = {
  swap: {
    tier: 'core',
    networks: ['solana-mainnet'],
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
  // Reference Powerup with an amount: the amount card, its USD conversion
  // and typed confirmation rows. Listed only where a stage enables it.
  'transfer-sol': {
    tier: 'core',
    networks: ['solana-mainnet', 'solana-devnet'],
    contributor: null,
    programIds: [transferSol.SYSTEM_PROGRAM_ID],
    lookupTables: [],
    errorCodes: ['amount_too_small'],
    providerProfile: 'coingecko',
    adapter: transferSol,
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
