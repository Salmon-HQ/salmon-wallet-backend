'use strict';

/**
 * Sanctions screening of a wallet address (spec 018, US3), for rows whose
 * routing provider does not screen (Jupiter). Two layers, either one
 * listing the address is enough:
 *
 *   1. the local copy of the US Treasury SDN list (`refreshSanctionsJob`,
 *      daily) — exact match, authoritative: the free TRM endpoint answered
 *      "not sanctioned" for addresses on that list (probed 2026-09-30);
 *   2. TRM Labs' free screening API, cached per address for a day — extra
 *      coverage when it answers, never a reason to skip layer 1.
 *
 * The local copy missing, unreadable or older than seven days →
 * `SanctionsUnavailableError` (503 `upstream_unavailable`), whatever TRM
 * would say: screening is never skipped silently and never rests on the
 * weak layer alone. The address is never logged.
 */

const http = require('axios');
const repository = require('../../repositories/shared/sanctions-repository');
const { providerCall } = require('../../infrastructure/providers/provider-client');

const TRM_ENDPOINT = 'https://api.trmlabs.com/public/v1/sanctions/screening';
const STALE_MS = 48 * 60 * 60 * 1000;
/** Past this, the local copy no longer counts as an answer: too old to be the authoritative layer. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

class SanctionsUnavailableError extends Error {
  constructor() {
    super('Sanctions screening is temporarily unavailable.');
    this.statusCode = 503;
    this.errorCode = 'upstream_unavailable';
  }
}

/** @returns {Promise<boolean|null>} null when the local copy cannot answer. */
const localVerdict = async (address) => {
  try {
    if (!(await repository.hasLocalList())) {
      console.error('[SANCTIONS_LOCAL_MISSING]');
      return null;
    }
    const fetchedAt = await repository.getFetchedAt();
    const age = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Infinity;
    if (age > STALE_MS) console.error('[SANCTIONS_STALE]', { fetchedAt });
    if (age > MAX_AGE_MS) {
      console.error('[SANCTIONS_LOCAL_EXPIRED]', { fetchedAt });
      return null;
    }
    return await repository.isListedLocally(address);
  } catch (error) {
    console.warn('[SANCTIONS_LOCAL_ERROR]', error.message);
    return null;
  }
};

/** @returns {Promise<boolean|null>} null when TRM did not answer. */
const trmVerdict = async (address, locals) => {
  const cached = await repository.getTrmVerdict(address);
  if (cached && typeof cached.isSanctioned === 'boolean') return cached.isSanctioned;
  try {
    const headers = { 'content-type': 'application/json' };
    if (process.env.TRM_API_KEY) headers['TRM-API-Key'] = process.env.TRM_API_KEY;
    const { data } = await providerCall(
      'trm',
      ({ timeout, signal }) => http.post(TRM_ENDPOINT, [{ address }], { headers, timeout, signal }),
      { locals, operationName: 'TRM sanctions screening' }
    );
    const verdict = data?.[0]?.isSanctioned;
    if (typeof verdict !== 'boolean') return null;
    await repository.saveTrmVerdict(address, verdict);
    return verdict;
  } catch (error) {
    console.warn('[SANCTIONS_TRM_ERROR]', error.errorCode || error.message);
    return null;
  }
};

/**
 * @param {string} address
 * @param {{ locals?: object }} [options]
 * @returns {Promise<boolean>} true when any layer lists the address.
 * @throws {SanctionsUnavailableError} when no layer could answer.
 */
const isListed = async (address, { locals } = {}) => {
  // A hand-blocked address (a provider's written request) is refused before
  // any list is consulted, and whether or not the SDN copy is in place.
  if (await repository.isBlockedManually(address)) return true;
  const local = await localVerdict(address);
  if (local === true) return true;
  // The Treasury copy is the authoritative layer: without it there is no
  // answer, whatever TRM says — its free endpoint cleared listed addresses.
  if (local === null) throw new SanctionsUnavailableError();
  return (await trmVerdict(address, locals)) === true;
};

module.exports = { isListed, SanctionsUnavailableError, TRM_ENDPOINT };
