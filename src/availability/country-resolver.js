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
 * `AVAILABILITY_COUNTRY_OVERRIDE` forces a country on every stage except
 * `prod`, so the gate can be exercised locally where every address is
 * private.
 */

const fs = require('fs');
const { Reader } = require('mmdb-lib');
const { resolveSourceIp } = require('../../packages/network-utils');

const DATABASE = require.resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');
const COUNTRY_CODE = /^[A-Z]{2}$/;

let reader;
const getReader = () => {
  if (!reader) reader = new Reader(fs.readFileSync(DATABASE));
  return reader;
};

/**
 * @param {string|undefined|null} ip
 * @returns {string|null} ISO 3166-1 alpha-2, upper case, or null.
 */
const countryOf = (ip) => {
  if (typeof ip !== 'string' || ip.length === 0) return null;
  try {
    const code = getReader().get(ip)?.country_code;
    return typeof code === 'string' && COUNTRY_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
};

const localOverride = () => {
  if (process.env.NODE_ENV === 'prod') return null;
  const value = (process.env.AVAILABILITY_COUNTRY_OVERRIDE || '').trim().toUpperCase();
  return COUNTRY_CODE.test(value) ? value : null;
};

/**
 * @param {import('express').Request} req
 * @returns {string|null}
 */
const countryOfRequest = (req) => localOverride() || countryOf(resolveSourceIp(req));

module.exports = { countryOf, countryOfRequest };
