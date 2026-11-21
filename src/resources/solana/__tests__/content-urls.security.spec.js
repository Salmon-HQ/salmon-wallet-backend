'use strict';

/**
 * Abuse case: regular-expression denial of service (ReDoS). An NFT's media
 * and metadata URLs are written by whoever mints it, and every listing
 * normalizes them on the request path, so the rewrite must stay linear in the
 * URL's length.
 */

const { normalizeIpfsUrl } = require('../content-urls');

// A quadratic pattern needs minutes for this size; a linear one, milliseconds.
const BUDGET_MS = 1000;

describe('abuse: a crafted content URL that stalls the IPFS rewrite', () => {
  test('a subdomain-gateway URL built to backtrack is handled in linear time', () => {
    const url = `http://0.ipfs.${'.'.repeat(100_000)}/\nx`;

    const start = process.hrtime.bigint();
    normalizeIpfsUrl(url);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test('a subdomain-gateway URL is still rewritten, path kept and query dropped', () => {
    const gateway = 'https://ipfs.filebase.io/ipfs/';

    expect(normalizeIpfsUrl('https://bafyabc.ipfs.dweb.link')).toBe(`${gateway}bafyabc`);
    expect(normalizeIpfsUrl('https://bafyabc.ipfs.dweb.link/')).toBe(`${gateway}bafyabc`);
    expect(normalizeIpfsUrl('https://bafyabc.ipfs.dweb.link/1.png?x=1#y')).toBe(
      `${gateway}bafyabc/1.png`
    );
  });
});
