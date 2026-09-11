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
 *       validate(query) → { params } | { error, error_description },   // codes: missing_parameter / invalid_parameter / one of errorCodes
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

const POWERUPS = {
  swap: {
    tier: 'core',
    networks: ['solana-mainnet'],
    contributor: null,
    endpoints: [],
  },
};

module.exports = { POWERUPS };
