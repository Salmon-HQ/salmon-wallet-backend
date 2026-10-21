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

// Content-addressed storage: the document behind a CID cannot change. Any
// other host can, and may be the minter's own server, so a day.
const CONTENT_ADDRESSED_TTL = 30 * 24 * 60 * 60; // 30 days
const OK_TTL = 24 * 60 * 60; // 1 day
const FAIL_TTL = 60 * 60; // 1 hour
// After normalizeIpfsUrl: IPFS on the default gateway, or an Arweave
// transaction id (ArNS names, which can be repointed, are subdomains).
const CONTENT_ADDRESSED_URL =
  /^https:\/\/(ipfs\.filebase\.io\/ipfs\/|arweave\.net\/[\w-]{43}(\/|$))/;

// The document is attacker-chosen and is stored in the Redis that rate
// limits, sanctions and breakers share. Only what the NFT resource and the
// spam detector read is kept, and a document still over MAX_STORED_BYTES once
// trimmed counts as unresolved: at most 100 NFTs per page x 16 KB = 1.6 MB
// per listing, against 100 x 512 KB = 50 MB for whole documents.
const STORED_FIELDS = [
  'name',
  'symbol',
  'description',
  'image',
  'animation_url',
  'collection',
  'attributes',
  'properties',
  'creators',
];
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_ATTRIBUTES = 50;
const MAX_STORED_BYTES = 16 * 1024;

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
    `nft_offchain_metadata:${crypto.createHash('sha256').update(url).digest('hex')}`,
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

/** The stored subset of a metadata document, or null when it is too large. */
const toStoredMetadata = (document) => {
  const kept = {};
  for (const field of STORED_FIELDS) {
    if (document[field] !== undefined) kept[field] = document[field];
  }
  if (typeof kept.description === 'string') {
    kept.description = kept.description.slice(0, MAX_DESCRIPTION_CHARS);
  }
  if (Array.isArray(kept.attributes)) kept.attributes = kept.attributes.slice(0, MAX_ATTRIBUTES);
  return Buffer.byteLength(JSON.stringify(kept)) <= MAX_STORED_BYTES ? kept : null;
};

/**
 * True when a URL's host is an IP literal.
 *
 * Node's `net.Socket` short-circuits `lookupAndConnect` when the host is
 * already an IP, so the agents' `guardedLookup` hook is never called and the
 * whole destination policy is off the connection path. No legitimate NFT
 * metadata is served from a bare IP, so refusing literal hosts restores the
 * guarantee without weakening the hostname case, which guardedLookup still
 * covers against DNS rebinding.
 *
 * @param {string} url
 * @returns {boolean}
 */
const hasIpLiteralHost = (url) => {
  try {
    return net.isIP(new URL(url).hostname.replace(/^\[|\]$/g, '')) !== 0;
  } catch {
    return true;
  }
};

/**
 * @param {string} url
 * @param {AbortSignal} [signal] - the listing's deadline; aborts the fetch too.
 */
const fetchOffchainMetadata = async (url, signal) => {
  const { protocol } = new URL(url);
  if (protocol !== 'https:' && protocol !== 'http:') {
    return null;
  }

  if (hasIpLiteralHost(url)) return null;

  // A wall-clock deadline over the whole exchange. axios's `timeout` stops
  // counting once the headers arrive, so a server trickling its body a byte
  // at a time kept the fetch open until the Lambda timed out. An explicit
  // timer, not AbortSignal.timeout: that one is unref'd.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await http.get(url, {
      signal: signal ? AbortSignal.any([deadline.signal, signal]) : deadline.signal,
      maxRedirects: MAX_REDIRECTS,
      maxContentLength: MAX_BYTES,
      httpsAgent,
      httpAgent,
      headers: { Accept: 'application/json' },
      // A permitted hostname can redirect to an IP literal, which would put the
      // destination back outside guardedLookup's reach, so every hop is checked.
      beforeRedirect: (options) => {
        if (hasIpLiteralHost(options.href)) {
          const denied = new Error(`Refusing to fetch NFT metadata from ${options.href}`);
          denied.code = 'BLOCKED_ADDRESS';
          throw denied;
        }
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const document = asMetadataObject(response.data);
    return document && toStoredMetadata(document);
  } finally {
    clearTimeout(timer);
  }
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
 * @param {AbortSignal} [signal] - The listing's deadline. A fetch it cuts off
 *   is not cached as a failure: the listing ran out of time, not the server.
 * @returns {Promise<Object|null>} The off-chain JSON, or null when unresolved.
 */
const getOffchainMetadata = async (url, locals, signal) => {
  const key = cacheKeyFor(url, locals);

  const cached = await getFromCache(key);
  if (cached) {
    return cached.ok ? cached.json : null;
  }

  try {
    const json = await fetchOffchainMetadata(url, signal);
    if (json) {
      await storeInCache(
        key,
        { ok: true, json },
        CONTENT_ADDRESSED_URL.test(url) ? CONTENT_ADDRESSED_TTL : OK_TTL
      );
      return json;
    }
    await storeInCache(key, { ok: false }, FAIL_TTL);
    return null;
  } catch {
    if (signal?.aborted) return null;
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
    FETCH_TIMEOUT_MS,
    MAX_DESCRIPTION_CHARS,
    MAX_ATTRIBUTES,
    MAX_STORED_BYTES,
  },
};
