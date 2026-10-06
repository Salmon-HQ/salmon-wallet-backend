'use strict';

/**
 * The caller's country, from the source address API Gateway attaches to the
 * request (never from a header), looked up in the DB-IP "IP to Country Lite"
 * database shipped in the bundle (`@ip-location-db/dbip-country-mmdb`,
 * CC BY 4.0 — attribution in NOTICE). The database is opened once per
 * container.
 *
 * Unknown, private or malformed addresses answer `null`; the gate treats
 * that as "no country found", which on a denylist means unrestricted.
 *
 * Some Ukrainian regions answer their ISO 3166-2 code instead of `UA`
 * (`UA-43` Crimea, `UA-40` Sevastopol, `UA-14` Donetsk, `UA-09` Luhansk,
 * `UA-65` Kherson, `UA-23` Zaporizhzhia), so the table can block them while
 * the rest of Ukraine stays open. The country database has no region field,
 * so their ranges come from `region-ranges.json`, extracted from DB-IP City
 * Lite by `scripts/build-region-ranges.mjs`. DB-IP files much of Crimea
 * under RU: the ranges win over whatever country the database says.
 *
 * `AVAILABILITY_COUNTRY_OVERRIDE` forces a country on every stage except
 * `prod`, so the gate can be exercised locally where every address is
 * private.
 */

const fs = require('fs');
const net = require('net');
const { Reader } = require('mmdb-lib');
const { resolveSourceIp } = require('../../packages/network-utils');

const DATABASE = require.resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');
const COUNTRY_CODE = /^[A-Z]{2}$/;

/** IPv4 or IPv6 text → BigInt, so both families sort and compare the same way. */
const toBigInt = (ip) => {
  if (net.isIPv4(ip)) {
    return ip.split('.').reduce((acc, octet) => (acc << 8n) + BigInt(Number(octet)), 0n);
  }
  let [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || '0', 16)), 0n);
};

const buildRegionIndex = () => {
  const { ranges } = require('./region-ranges.json');
  const byFamily = { 4: [], 6: [] };
  for (const [start, end, code] of ranges) {
    byFamily[net.isIPv4(start) ? 4 : 6].push([toBigInt(start), toBigInt(end), code]);
  }
  for (const list of Object.values(byFamily)) list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return byFamily;
};

let regionIndex;

/** The ISO 3166-2 region whose range holds `ip`, or null. Binary search. */
const regionOf = (ip) => {
  const family = net.isIP(ip);
  if (!family) return null;
  regionIndex ||= buildRegionIndex();
  const list = regionIndex[family];
  const value = toBigInt(ip);
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end, code] = list[mid];
    if (value < start) high = mid - 1;
    else if (value > end) low = mid + 1;
    else return code;
  }
  return null;
};

/** The country database could not be opened: the gate cannot decide, so it refuses rather than opens. */
class CountryDatabaseUnavailableError extends Error {
  constructor(cause) {
    super('The country database is unavailable.');
    this.statusCode = 503;
    this.errorCode = 'upstream_unavailable';
    this.cause = cause;
  }
}

let reader;
let loadError;
/**
 * Opened once per container. A load failure (file missing from the bundle,
 * corrupt, a package bump that changed the shape) is logged once and thrown
 * on every lookup: an unreadable database must never read as "no country",
 * which the table treats as unrestricted.
 */
const getReader = () => {
  if (reader) return reader;
  if (loadError) throw new CountryDatabaseUnavailableError(loadError);
  try {
    reader = new Reader(fs.readFileSync(DATABASE));
    return reader;
  } catch (error) {
    loadError = error;
    console.error('[COUNTRY_DB_UNAVAILABLE]', { message: error.message });
    throw new CountryDatabaseUnavailableError(error);
  }
};

/**
 * @param {string|undefined|null} ip
 * @returns {string|null} ISO 3166-1 alpha-2, upper case, or null for a private, unknown or malformed address.
 * @throws {CountryDatabaseUnavailableError} when the database cannot be opened.
 */
const countryOf = (ip) => {
  if (typeof ip !== 'string' || ip.length === 0) return null;
  const db = getReader();
  const region = regionOf(ip);
  if (region) return region;
  try {
    const code = db.get(ip)?.country_code;
    return typeof code === 'string' && COUNTRY_CODE.test(code) ? code : null;
  } catch {
    // A malformed address is the caller's; the database answered nothing.
    return null;
  }
};

/** Test seam: forget the opened database and any load failure. */
const resetCountryDatabase = () => {
  reader = undefined;
  loadError = undefined;
};

const localOverride = () => {
  if (process.env.NODE_ENV === 'prod') return null;
  const value = (process.env.AVAILABILITY_COUNTRY_OVERRIDE || '').trim().toUpperCase();
  return /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(value) ? value : null;
};

/**
 * @param {import('express').Request} req
 * @returns {string|null}
 */
const countryOfRequest = (req) => localOverride() || countryOf(resolveSourceIp(req));

module.exports = {
  countryOf,
  countryOfRequest,
  resetCountryDatabase,
  CountryDatabaseUnavailableError,
};
