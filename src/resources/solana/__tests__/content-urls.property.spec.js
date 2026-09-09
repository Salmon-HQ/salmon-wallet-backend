'use strict';

/**
 * Property-based tests (fast-check) for content-URL normalization. NFT
 * metadata URLs are attacker-controlled strings rendered by the wallet, so
 * the normalizer must be total (never throw) and must not emit query strings
 * or fragments through the IPFS gateway rewrite.
 */

const fc = require('fast-check');
const { cleanIpfsHash, normalizeIpfsUrl } = require('../content-urls');

const GATEWAY = 'https://ipfs.io/ipfs/';

describe('content-urls (property-based)', () => {
  it('normalizeIpfsUrl is total over strings and only answers string or null', () => {
    fc.assert(
      fc.property(fc.string(), (url) => {
        const out = normalizeIpfsUrl(url);
        expect(out === null || typeof out === 'string').toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('normalizeIpfsUrl is idempotent: normalizing twice equals normalizing once', () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (url) => {
        const once = normalizeIpfsUrl(url);
        expect(normalizeIpfsUrl(once)).toBe(once);
      }),
      { numRuns: 300 }
    );
  });

  it('ipfs:// and ar:// URIs always land on the https gateway', () => {
    const cid = fc.stringMatching(/^[a-zA-Z0-9]{10,64}$/);
    fc.assert(
      fc.property(cid, (hash) => {
        expect(normalizeIpfsUrl(`ipfs://${hash}`)).toBe(`${GATEWAY}${hash}`);
        expect(normalizeIpfsUrl(`ar://${hash}`)).toBe(`https://arweave.net/${hash}`);
      })
    );
  });

  it('cleanIpfsHash strips everything after ? or # and never adds characters', () => {
    fc.assert(
      fc.property(fc.string(), (hash) => {
        const out = cleanIpfsHash(hash);
        if (!hash) {
          expect(out).toBe(hash);
          return;
        }
        expect(out.includes('?')).toBe(false);
        expect(out.includes('#')).toBe(false);
        expect(hash.startsWith(out)).toBe(true);
      })
    );
  });
});
