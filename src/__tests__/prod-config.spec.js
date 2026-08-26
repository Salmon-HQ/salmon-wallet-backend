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
});
