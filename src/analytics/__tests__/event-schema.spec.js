'use strict';

const {
  validateEvent,
  safeValidateEvent,
  isAddressLike,
  AnalyticsValidationError,
} = require('../event-schema');

describe('event-schema guardrail (server mirror)', () => {
  it('flags base58 and hex addresses', () => {
    expect(isAddressLike('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(true);
    expect(isAddressLike('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe(true);
    expect(isAddressLike('solana')).toBe(false);
  });

  it('accepts a known event with allow-listed props', () => {
    expect(
      validateEvent('swap_completed', { from_chain: 'solana', to_chain: 'ethereum', success: true })
    ).toEqual({
      event: 'swap_completed',
      props: { from_chain: 'solana', to_chain: 'ethereum', success: true },
    });
  });

  it('rejects unknown events', () => {
    expect(() => validateEvent('exfiltrate')).toThrow(AnalyticsValidationError);
  });

  it('rejects non-allow-listed prop keys', () => {
    expect(() => validateEvent('send_completed', { address: 'solana' })).toThrow(
      /not allow-listed/
    );
  });

  it('rejects address-shaped values', () => {
    expect(() =>
      validateEvent('send_completed', { chain: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' })
    ).toThrow(/address\/mint/);
  });

  it('rejects raw numbers and out-of-enum values', () => {
    expect(() => validateEvent('send_completed', { amount_bucket: 42 })).toThrow(
      /string or boolean/
    );
    expect(() => validateEvent('send_completed', { chain: 'dogecoin' })).toThrow(/not allowed/);
  });

  it('safeValidateEvent returns null instead of throwing', () => {
    expect(safeValidateEvent('nope')).toBeNull();
  });
});
