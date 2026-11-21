'use strict';

/**
 * Abuse case: regular-expression denial of service (ReDoS) through a hostile
 * page. `GET /dapp` is anonymous and reads the page at the URL the caller
 * names, so the caller chooses every byte the OpenGraph reader sees: up to
 * 256 kB of it must be read in linear time.
 */

const { extractOpenGraphTags } = require('../dapp-service');

// Measured on a laptop: the unbounded pattern took 4 s and 24 s on these two
// pages, the bounded one under 100 ms.
const BUDGET_MS = 2000;
const PAGE_BYTES = 256 * 1024;

describe('[API4:2023] abuse: a page built to stall the OpenGraph reader', () => {
  test.each([
    ['one <meta that never closes', `<meta${' '.repeat(PAGE_BYTES)}`],
    ['thousands of <meta openings that never close', '<meta '.repeat(PAGE_BYTES / 6)],
  ])('%s is read in linear time', (_label, html) => {
    const start = process.hrtime.bigint();
    const tags = extractOpenGraphTags(html);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

    expect(tags).toEqual({});
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test('ordinary tags are still read, long content included', () => {
    const description = 'd'.repeat(1500);
    const html = `<head><meta property="og:title" content="Salmon"><meta
      name="description" content="${description}"></head>`;

    expect(extractOpenGraphTags(html)).toEqual({ 'og:title': 'Salmon', description });
  });
});
