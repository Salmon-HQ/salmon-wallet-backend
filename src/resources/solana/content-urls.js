'use strict';

const DEAD_DOMAINS = [
  'shdw-drive.genesysgo.net',
  'chexbacca.com',
  'cdn.bridgesplit.com',
  'lychee.pics',
];

const BROKEN_GATEWAY_PATTERNS = [
  /https?:\/\/(?:www\.)?cf-ipfs\.com\/ipfs\/(.+)/,
  /https?:\/\/(?:www\.)?cloudflare-ipfs\.com\/ipfs\/(.+)/,
  /https?:\/\/(?:www\.)?ipfs\.infura\.io\/ipfs\/(.+)/,
  /https?:\/\/gateway\.pinata\.cloud\/ipfs\/(.+)/,
  /https?:\/\/(?:www\.)?nftstorage\.link\/ipfs\/(.+)/,
];

const SUBDOMAIN_IPFS_PATTERN = /https?:\/\/([a-zA-Z0-9]+)\.ipfs\.([^/]+)\/?(.*)$/;
const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

/**
 * Strips the query string and fragment from an IPFS hash/path.
 * @param {string} hash - raw hash or path fragment
 * @returns {string} hash without `?query`/`#fragment` (returned unchanged when falsy)
 */
const cleanIpfsHash = (hash) => {
  if (!hash) return hash;
  return hash.split('?')[0].split('#')[0];
};

/**
 * Rewrites a content URL (NFT/token logo, metadata URI, etc.) to a stable
 * gateway. Converts `ipfs://` and `ar://` URIs, fixes known-broken gateway
 * hosts (cf-ipfs, pinata, nftstorage, subdomain-style IPFS gateways) to the
 * default `ipfs.io` gateway, and returns `null` for known-dead domains.
 * @param {string} url - raw content URL
 * @returns {string|null|undefined} normalized URL, `null` when the domain is
 *   known-dead, or the original `url` unchanged when no rule applies
 */
const normalizeIpfsUrl = (url) => {
  if (!url) return url;

  if (DEAD_DOMAINS.some((domain) => url.includes(domain))) {
    return null;
  }

  if (url.startsWith('ipfs://')) {
    return url.replace(/^ipfs:\/\//, DEFAULT_IPFS_GATEWAY);
  }
  if (url.startsWith('ar://')) {
    return url.replace(/^ar:\/\//, 'https://arweave.net/');
  }
  if (url.includes('arweeve.net')) {
    return url.replace('arweeve.net', 'arweave.net');
  }

  const pinataMatch = url.match(/https?:\/\/[^/]+\.mypinata\.cloud\/ipfs\/(.+)/);
  if (pinataMatch) {
    return `${DEFAULT_IPFS_GATEWAY}${cleanIpfsHash(pinataMatch[1])}`;
  }

  for (const pattern of BROKEN_GATEWAY_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return `${DEFAULT_IPFS_GATEWAY}${cleanIpfsHash(match[1])}`;
    }
  }

  const subdomainMatch = url.match(SUBDOMAIN_IPFS_PATTERN);
  if (subdomainMatch) {
    const hash = subdomainMatch[1];
    const path = subdomainMatch[3] ? `/${subdomainMatch[3]}` : '';
    const cleanPath = path.split('?')[0].split('#')[0];
    return `${DEFAULT_IPFS_GATEWAY}${hash}${cleanPath}`;
  }

  return url;
};

module.exports = {
  cleanIpfsHash,
  normalizeIpfsUrl,
};
