'use strict';

/**
 * SSRF guard for the dApp metadata fetcher.
 *
 * `GET /v1/dapp/metadata` fetches a URL supplied by an unauthenticated caller,
 * so without a guard the Lambda is a general-purpose HTTP client for whoever
 * asks: internal hosts, loopback, cloud metadata endpoints, and any port on
 * any address reachable from wherever the function runs.
 *
 * The guard is applied per hop, not once: a permitted public host can redirect
 * to a private one, so every redirect target is re-validated before it is
 * followed.
 */

const dns = require('dns').promises;
const net = require('net');

/** Only these schemes are ever fetched. */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

class DappUrlError extends Error {
  constructor(message, errorCode = 'invalid_url', statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * IPv4 ranges that must never be fetched: unspecified, private, shared CGNAT,
 * loopback, link-local (which covers cloud metadata at 169.254.169.254),
 * IETF protocol assignments, benchmarking, multicast and reserved.
 * Each entry is `[firstOctet, predicate]` for a cheap lookup.
 */
const isBlockedIpv4 = (address) => {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
};

/**
 * IPv6 equivalents: unspecified, loopback, unique-local (fc00::/7) and
 * link-local (fe80::/10). IPv4-mapped addresses are unwrapped so a private
 * IPv4 cannot slip through as `::ffff:10.0.0.1`.
 */
const isBlockedIpv6 = (address) => {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  const head = normalized.slice(0, 4);
  if (/^f[cd]/.test(head)) return true;
  return /^fe[89ab]/.test(head);
};

/**
 * True when an IP literal must not be fetched.
 * @param {string} address
 * @returns {boolean}
 */
const isBlockedAddress = (address) => {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
};

/**
 * Parses and validates a caller-supplied dApp URL.
 *
 * Resolves the hostname and rejects the request when ANY resolved address is
 * private — a hostname can legitimately resolve to several addresses, and
 * accepting the URL because one of them is public would let an attacker point
 * a public name at an internal address.
 *
 * Returns the address that was validated alongside the URL so the caller can
 * pin the connection to it: resolving again at connect time would let a
 * DNS answer that flips between validation and connect (rebinding) reach a
 * private address the guard never saw.
 *
 * @param {string} rawUrl
 * @returns {Promise<{url: URL, address: string, family: 4|6}>} the validated
 *   URL and the resolved address the connection must use
 * @throws {DappUrlError} 400 when the URL is missing, malformed, non-HTTP, or
 *   resolves to a non-public address.
 */
const assertFetchableUrl = async (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new DappUrlError('Missing url query parameter', 'missing_parameter');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DappUrlError('The url query parameter is not a valid URL.');
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new DappUrlError('Only http and https URLs can be fetched.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new DappUrlError('The url query parameter points to a non-public address.');
    }
    return { url, address: hostname, family: net.isIP(hostname) };
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new DappUrlError('The url query parameter points to a host that cannot be resolved.');
  }

  if (records.length === 0 || records.some(({ address }) => isBlockedAddress(address))) {
    throw new DappUrlError('The url query parameter points to a non-public address.');
  }

  const [{ address, family }] = records;
  return { url, address, family };
};

module.exports = { assertFetchableUrl, isBlockedAddress, DappUrlError };
