'use strict';

/**
 * Abuse case: regular-expression denial of service (ReDoS) through the log
 * path. Every error is redacted before it is logged, and an error message can
 * carry text an upstream or a caller wrote, so redaction must stay linear in
 * the length of what it is handed.
 */

const { redact } = require('../log-redaction');

// Measured on a laptop: the unbounded pattern took 2 s on 60 kB of word
// characters, the bounded one under 50 ms on 200 kB.
const BUDGET_MS = 2000;

describe('[API4:2023] abuse: a long message built to stall log redaction', () => {
  test.each([
    ['a run of word characters', 'a'.repeat(200_000)],
    ['a run of dashes and underscores', '-_'.repeat(100_000)],
    ['a query string that never names a credential', `?${'k'.repeat(200_000)}`],
  ])('%s is redacted in linear time', (_label, message) => {
    const start = process.hrtime.bigint();
    redact(message);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test('a credential is still redacted behind a long key prefix', () => {
    expect(redact(`x-${'vendor-'.repeat(8)}api-key: sk_live_123`)).not.toContain('sk_live_123');
    expect(redact('{"apiKey":"sk_live_123"}')).not.toContain('sk_live_123');
  });
});
