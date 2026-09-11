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
 *     programIds?: string[],                    // transaction-building: every program an instruction may reference
 *     adapter?: {
 *       validate(query) → { params } | { error, error_description },   // 400 codes: missing_parameter / invalid_parameter
 *       build(params, { locals, connection }) → {
 *         instructions, lookupTableAddresses?, salmonFee?,           // salmonFee: pass-through object or absent (null)
 *         provider?: { id, displayName, attribution },               // data provider behind the build, if any
 *         display: { ...typed fields the client renders },
 *       },
 *     },
 *   }
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
