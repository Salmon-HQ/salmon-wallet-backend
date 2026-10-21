'use strict';

/**
 * The caller's country, from the source address API Gateway attaches to the
 * request (never from a header), looked up in DB-IP's "IP to Country Lite"
 * database (CC BY 4.0 — attribution in NOTICE). Every deploy downloads the
 * month's edition into `data/` (`scripts/refresh-geo-data.mjs`); without it,
 * local runs and tests read the copy in `@ip-location-db/dbip-country-mmdb`,
 * which stopped being republished in June 2026. The database is opened once
 * per container.
 *
 * Unknown, private or malformed addresses answer `null`, and so does every
 * address on a deployed stage (prod, staging) once the database is older than
 * 45 days: IP blocks change country every month, and the gate refuses a
 * regulated capability when the country is `null`.
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

const path = require('path');

const FRESH_DATABASE = path.join(__dirname, 'data', 'dbip-country-lite.mmdb');
const COUNTRY_CODE = /^[A-Z]{2}$/;
const MAX_DATABASE_AGE_MS = 45 * 24 * 60 * 60 * 1000;

const databasePath = () =>
  fs.existsSync(FRESH_DATABASE)
    ? FRESH_DATABASE
    : require.resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');

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
 * which leaves unregulated capabilities open.
 */
const getReader = () => {
  if (reader) return reader;
  if (loadError) throw new CountryDatabaseUnavailableError(loadError);
  try {
    reader = new Reader(fs.readFileSync(databasePath()));
    return reader;
  } catch (error) {
    loadError = error;
    console.error('[COUNTRY_DB_UNAVAILABLE]', { message: error.message });
    throw new CountryDatabaseUnavailableError(error);
  }
};

/** When the open database was built by DB-IP. */
const databaseBuiltAt = () => getReader().metadata.buildEpoch;

// Every deployed stage downloads the month's database, and staging builds
// real mainnet swaps, so the age limit holds on all of them, and on anything
// running with NODE_ENV prod. `local` runs and tests (no STAGE) read the
// packaged copy, which is older than 45 days.
const enforcesDatabaseAge = () =>
  process.env.NODE_ENV === 'prod' || (Boolean(process.env.STAGE) && process.env.STAGE !== 'local');

let warnedStale = false;
const isStale = () => {
  if (!enforcesDatabaseAge()) return false;
  const age = Date.now() - databaseBuiltAt().getTime();
  if (age <= MAX_DATABASE_AGE_MS) return false;
  if (!warnedStale) {
    warnedStale = true;
    console.error('[COUNTRY_DB_STALE]', { builtAt: databaseBuiltAt().toISOString() });
  }
  return true;
};

/**
 * @param {string|undefined|null} ip
 * @returns {string|null} ISO 3166-1 alpha-2, upper case, or null for a private, unknown or
 *   malformed address, and for every address once the database is stale on a deployed stage.
 * @throws {CountryDatabaseUnavailableError} when the database cannot be opened.
 */
const countryOf = (ip) => {
  if (typeof ip !== 'string' || ip.length === 0) return null;
  // `::ffff:5.3.41.10` is an IPv4 address; read as IPv6 it would skip the
  // region ranges and a Crimean address would come back as RU.
  if (ip.toLowerCase().startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  const db = getReader();
  if (isStale()) return null;
  const region = regionOf(ip);
  if (region) return region;
  try {
    const record = db.get(ip);
    // DB-IP's own files carry `country.iso_code`; the npm copy flattens it to `country_code`.
    const code = record?.country?.iso_code ?? record?.country_code;
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
  warnedStale = false;
};

const localOverride = () => {
  if (process.env.NODE_ENV === 'prod') return null;
  const value = (process.env.AVAILABILITY_COUNTRY_OVERRIDE || '').trim().toUpperCase();
  return /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(value) ? value : null;
};

/**
 * True when the request reached API Gateway through a CloudFront distribution
 * of ours: API Gateway's edge adds one CloudFront hop to `Via`, every
 * CloudFront in front of it adds another. The source address is then that
 * CloudFront server, not the caller, and can sit in another country. A client
 * can only add hops, which closes Swap for itself.
 */
const behindCloudFront = (req) => {
  const via = String(req.headers?.via || req.headers?.Via || '');
  return via.split(',').filter((hop) => /cloudfront/i.test(hop)).length > 1;
};

/**
 * @param {import('express').Request} req
 * @returns {string|null}
 */
const countryOfRequest = (req) =>
  localOverride() || (behindCloudFront(req) ? null : countryOf(resolveSourceIp(req)));

module.exports = {
  countryOf,
  countryOfRequest,
  databaseBuiltAt,
  resetCountryDatabase,
  CountryDatabaseUnavailableError,
};
