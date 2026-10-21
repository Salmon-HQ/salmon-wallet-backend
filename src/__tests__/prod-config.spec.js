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
const yaml = require('js-yaml');

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

  it('reads the Redis TLS switch from configuration on every stage', () => {
    expect(defaultFor('REDIS_TLS')).toBe('false');
    const local = fs.readFileSync(
      path.join(__dirname, '..', '..', 'config', 'env.local.yml'),
      'utf8'
    );
    expect(local).toMatch(/^\s*REDIS_TLS:/m);
  });
});

// Each Lambda receives only the variables its own code reads, so a flaw in the
// anonymous analytics ingest or a scheduled job cannot expose the credentials
// the wallet API holds.
describe('per-function environment', () => {
  const readStage = (stage) =>
    yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', 'config', `env.${stage}.yml`)), {
      // Serverless parses these files as YAML 1.1, where `<<` merges a group.
      schema: yaml.YAML11_SCHEMA,
    });
  const serverless = fs.readFileSync(path.join(__dirname, '..', '..', 'serverless.yml'), 'utf8');

  const SECRETS = [
    'REDIS_PASSWORD',
    'COINGECKO_API_KEY',
    'TRM_API_KEY',
    'JUPITER_API_KEY',
    'ZEROEX_API_KEY',
    'ZEROEX_SIGNING_KEYS',
    'TRITON_RPC_URL',
    'TRITON_RPC_URL_DEVNET',
    'GA4_API_SECRET',
  ];
  const ALLOWED = {
    api: [
      'COINGECKO_API_KEY',
      'JUPITER_API_KEY',
      'REDIS_PASSWORD',
      'TRITON_RPC_URL',
      'TRITON_RPC_URL_DEVNET',
      'TRM_API_KEY',
      'ZEROEX_API_KEY',
      'ZEROEX_SIGNING_KEYS',
    ],
    coingeckoJob: ['COINGECKO_API_KEY', 'REDIS_PASSWORD'],
    sanctionsJob: ['REDIS_PASSWORD'],
    skrJob: ['REDIS_PASSWORD', 'TRITON_RPC_URL'],
    events: ['GA4_API_SECRET'],
  };

  it('sets no environment that every function inherits', () => {
    expect(serverless).not.toMatch(/^ {2}environment:/m);
  });

  it('wires every function to one of the per-function maps', () => {
    const maps = [...serverless.matchAll(/^ {4}environment: \$\{self:custom\.envFile\.(\w+)\}$/gm)];
    expect(maps.map((m) => m[1]).sort()).toEqual([
      'api',
      'coingeckoJob',
      'coingeckoJob',
      'events',
      'sanctionsJob',
      'skrJob',
    ]);
  });

  it.each(['local', 'staging', 'prod'])(
    'hands each function only its own secrets (%s)',
    (stage) => {
      const config = readStage(stage);
      for (const [map, allowed] of Object.entries(ALLOWED)) {
        const held = Object.keys(config[map]).filter((name) => SECRETS.includes(name));
        expect({ map, held: held.sort() }).toEqual({ map, held: allowed });
      }
    }
  );
});
