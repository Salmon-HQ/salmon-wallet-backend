'use strict';

/**
 * Server-side anonymity guardrail for the usage-analytics endpoint.
 *
 * This is a deliberate mirror of the wallet's
 * `packages/shared/src/analytics/{events,schema}.ts`. Both sides enforce the
 * same allow-list independently (defense in depth) — a change in one MUST be
 * reflected in the other. The client validates before sending; this validates
 * again on ingest so a tampered or drifted client can't slip PII through.
 */

const ANALYTICS_EVENTS = [
  'wallet_created',
  'wallet_recovered',
  'first_send_completed',
  'first_swap_completed',
  'send_completed',
  'swap_completed',
  'nft_viewed',
  'nft_sent',
  'network_switched',
  'wallet_switched',
  'address_book_used',
];

const CHAINS = ['solana', 'bitcoin', 'ethereum'];
const AMOUNT_BUCKETS = ['0-10', '10-100', '100-1k', '1k-10k', '10k+'];
const ALLOWED_PROP_KEYS = ['chain', 'from_chain', 'to_chain', 'success', 'amount_bucket'];

const PROP_ENUMS = {
  chain: CHAINS,
  from_chain: CHAINS,
  to_chain: CHAINS,
  amount_bucket: AMOUNT_BUCKETS,
};

const MAX_PROP_STRING_LENGTH = 32;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const EVENT_SET = new Set(ANALYTICS_EVENTS);
const ALLOWED_PROP_KEY_SET = new Set(ALLOWED_PROP_KEYS);

/** Whether a string looks like a wallet address or token mint. */
function isAddressLike(value) {
  return BASE58_ADDRESS.test(value) || HEX_ADDRESS.test(value);
}

class AnalyticsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsValidationError';
  }
}

function assertValidPropValue(key, value) {
  if (typeof value === 'boolean') return;
  if (typeof value !== 'string') {
    throw new AnalyticsValidationError(`prop "${key}" must be a string or boolean`);
  }
  if (isAddressLike(value)) {
    throw new AnalyticsValidationError(`prop "${key}" looks like an address/mint`);
  }
  if (value.length > MAX_PROP_STRING_LENGTH) {
    throw new AnalyticsValidationError(`prop "${key}" exceeds ${MAX_PROP_STRING_LENGTH} chars`);
  }
  const allowed = PROP_ENUMS[key];
  if (allowed && !allowed.includes(value)) {
    throw new AnalyticsValidationError(`prop "${key}" value not allowed`);
  }
}

/**
 * Validates an event name + props. Returns `{ event, props }` with cleaned props,
 * or throws {@link AnalyticsValidationError}.
 */
function validateEvent(name, props = {}) {
  if (!EVENT_SET.has(name)) {
    throw new AnalyticsValidationError(`unknown event "${name}"`);
  }
  if (props === null || typeof props !== 'object' || Array.isArray(props)) {
    throw new AnalyticsValidationError('props must be a flat object');
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (!ALLOWED_PROP_KEY_SET.has(key)) {
      throw new AnalyticsValidationError(`prop key "${key}" is not allow-listed`);
    }
    assertValidPropValue(key, value);
    cleaned[key] = value;
  }
  return { event: name, props: cleaned };
}

/** Non-throwing variant used by the ingest handler. */
function safeValidateEvent(name, props = {}) {
  try {
    return validateEvent(name, props);
  } catch {
    return null;
  }
}

module.exports = {
  ANALYTICS_EVENTS,
  CHAINS,
  AMOUNT_BUCKETS,
  ALLOWED_PROP_KEYS,
  PROP_ENUMS,
  MAX_PROP_STRING_LENGTH,
  isAddressLike,
  validateEvent,
  safeValidateEvent,
  AnalyticsValidationError,
};
