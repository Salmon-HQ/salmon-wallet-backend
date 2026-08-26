'use strict';

/**
 * Off-chain NFT metadata repository — fetches the JSON document an NFT's
 * `json_uri` points at (Arweave / IPFS), with a Redis read-through cache.
 *
 * Why this exists: Triton's DAS index carries on-chain data only, so
 * `content.metadata` holds name/symbol/token_standard and nothing else. Helius
 * hydrates the off-chain JSON inside its own indexer, which is why the NFT
 * resource — written against the Helius shape — reads `json.description`,
 * `json.attributes` and `json.image`. Those fields silently went missing at the
 * Triton cutover. `nft-metadata-hydrator` restores them through this repository.
 *
 * SECURITY: the URI is attacker-controlled. Anyone can mint an NFT whose
 * `json_uri` points at an internal address, which would turn this into an SSRF
 * pivot (`169.254.169.254` is the cloud instance-metadata endpoint). Every
 * connection therefore resolves through `guardedLookup`, which refuses private,
 * loopback, and link-local addresses. Because the guard sits in the agent's DNS
 * lookup rather than in a URL check, it also covers redirect hops and defeats
 * DNS rebinding — the IP we validate is the IP we connect to.
 *
 * Failures are cached too (`FAIL_TTL`). Dead IPFS pins are common — nft.storage
 * sunset its free pinning and took a lot of NFT metadata with it — and without
 * a negative cache a wallet holding such NFTs would re-attempt every fetch, and
 * eat the timeout, on every single request.
 */

const http = require('axios');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');
const nodeHttp = require('http');

const { getCacheKey, getFromCache, storeInCache } = require('../helper');

const FETCH_TIMEOUT_MS = 3000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 2;

// Content-addressed storage: the document behind a CID cannot change.
const OK_TTL = 30 * 24 * 60 * 60; // 30 days
const FAIL_TTL = 60 * 60; // 1 hour

/**
 * True for addresses no outbound NFT-metadata fetch has any business reaching:
 * loopback, private ranges, CGNAT, multicast, and — the one that matters most —
 * the 169.254.0.0/16 link-local block that hosts cloud instance metadata.
 *
 * Anything that is not a parseable IP is refused as well, so a lookup returning
 * something unexpected fails closed.
 */
const isBlockedIp = (ip) => {
  const version = net.isIP(ip);

  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }

  return true;
};

const guardedLookup = (hostname, options, callback) => {
  const done = typeof options === 'function' ? options : callback;
  const lookupOptions = typeof options === 'function' ? {} : options;

  dns.lookup(hostname, lookupOptions, (error, address, family) => {
    if (error) return done(error);

    const resolved = Array.isArray(address) ? address : [{ address, family }];
    const blocked = resolved.find((entry) => isBlockedIp(entry.address));
    if (blocked) {
      const denied = new Error(`Refusing to fetch NFT metadata from ${blocked.address}`);
      denied.code = 'BLOCKED_ADDRESS';
      return done(denied);
    }

    return done(null, address, family);
  });
};

const httpsAgent = new https.Agent({ lookup: guardedLookup });
const httpAgent = new nodeHttp.Agent({ lookup: guardedLookup });

const cacheKeyFor = (url, locals) =>
  getCacheKey(
    `nft_offchain_metadata:${crypto.createHash('sha1').update(url).digest('hex')}`,
    locals
  );

/**
 * Some gateways serve metadata as `text/plain`, so axios hands back a raw
 * string. Parse it here rather than trusting the content type.
 */
const asMetadataObject = (payload) => {
  let value = payload;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
};

const fetchOffchainMetadata = async (url) => {
  const { protocol } = new URL(url);
  if (protocol !== 'https:' && protocol !== 'http:') {
    return null;
  }

  const response = await http.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxContentLength: MAX_BYTES,
    httpsAgent,
    httpAgent,
    headers: { Accept: 'application/json' },
    validateStatus: (status) => status >= 200 && status < 300,
  });

  return asMetadataObject(response.data);
};

/**
 * Read-through cache around `fetchOffchainMetadata`.
 *
 * Never throws: an NFT whose metadata cannot be fetched is not an error worth
 * failing the whole listing over. Callers treat `null` as "unresolved" and
 * fall back to the on-chain fields.
 *
 * @param {string} url - Normalized, fetchable https(s) metadata URL.
 * @param {Object} locals - Request locals (used for the cache key namespace).
 * @returns {Promise<Object|null>} The off-chain JSON, or null when unresolved.
 */
const getOffchainMetadata = async (url, locals) => {
  const key = cacheKeyFor(url, locals);

  const cached = await getFromCache(key);
  if (cached) {
    return cached.ok ? cached.json : null;
  }

  try {
    const json = await fetchOffchainMetadata(url);
    if (json) {
      await storeInCache(key, { ok: true, json }, OK_TTL);
      return json;
    }
    await storeInCache(key, { ok: false }, FAIL_TTL);
    return null;
  } catch {
    await storeInCache(key, { ok: false }, FAIL_TTL);
    return null;
  }
};

module.exports = {
  getOffchainMetadata,
  __testing: {
    isBlockedIp,
    guardedLookup,
    asMetadataObject,
    fetchOffchainMetadata,
  },
};
