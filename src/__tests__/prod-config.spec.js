'use strict';

/**
 * Guards the production defaults that live in `config/env.prod.yml`.
 *
 * These are plain YAML defaults behind optional SSM parameters, so nothing
 * else fails when one of them drifts to an unsafe value — the drift only
 * shows up as behaviour in production. `RATE_LIMIT_MODE` is the case that
 * already happened: the parameter was never created in SSM, so the 'log'
 * default meant the limiter counted excess requests and blocked none.
 */

const fs = require('fs');
const path = require('path');

const readProdConfig = () =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'env.prod.yml'), 'utf8');

const defaultFor = (variable) => {
  const match = readProdConfig().match(new RegExp(`^\\s*${variable}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  const fallback = match[1].match(/,\s*'([^']*)'\s*}/);
  return fallback ? fallback[1] : match[1].trim();
};

describe('production config defaults', () => {
  it('enforces the rate limit rather than only logging it', () => {
    expect(defaultFor('RATE_LIMIT_MODE')).toBe('enforce');
  });

  it('keeps the per-IP budgets explicit', () => {
    expect(defaultFor('RATE_LIMIT_MAX')).toBe('300');
    expect(defaultFor('RATE_LIMIT_TX_MAX')).toBe('30');
    expect(defaultFor('RATE_LIMIT_WINDOW_SECONDS')).toBe('60');
  });

  // The privacy policy states how long request logs are kept. The number
  // lives in one line of `serverless.yml`; changing it changes what the
  // policy must say, so the change has to be deliberate.
  it('keeps request logs for thirty days, as the privacy policy states', () => {
    const serverless = fs.readFileSync(path.join(__dirname, '..', '..', 'serverless.yml'), 'utf8');
    expect(serverless.match(/^\s*logRetentionInDays:\s*(\d+)\s*$/m)?.[1]).toBe('30');
  });

  // AWS WAF blocks a source IP before the request reaches API Gateway's
  // shared stage throttle; it must never block an IP the Express limiter
  // would still serve, nor let through more than it does.
  it('caps each IP at AWS WAF with the Express per-IP budget and window', () => {
    const serverless = fs.readFileSync(path.join(__dirname, '..', '..', 'serverless.yml'), 'utf8');
    expect(serverless.match(/^\s*wafRateLimitPerIp:\s*(\d+)\s*$/m)?.[1]).toBe(
      defaultFor('RATE_LIMIT_MAX')
    );
    expect(serverless.match(/^\s*EvaluationWindowSec:\s*(\d+)\s*$/m)?.[1]).toBe(
      defaultFor('RATE_LIMIT_WINDOW_SECONDS')
    );
  });

  it('reads the Redis TLS switch from configuration on every stage', () => {
    expect(defaultFor('REDIS_TLS')).toBe('false');
    const local = fs.readFileSync(
      path.join(__dirname, '..', '..', 'config', 'env.local.yml'),
      'utf8'
    );
    expect(local).toMatch(/^\s*REDIS_TLS:/m);
  });
});
