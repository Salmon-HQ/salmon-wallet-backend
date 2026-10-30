'use strict';

const {
  ANALYTICS_EVENTS,
  ALLOWED_PROP_KEYS,
  POWERUPS,
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
      validateEvent('send_completed', { from_chain: 'solana', to_chain: 'ethereum', success: true })
    ).toEqual({
      event: 'send_completed',
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
    expect(() => validateEvent('send_completed', { chain: 42 })).toThrow(/string or boolean/);
    expect(() => validateEvent('send_completed', { chain: 'dogecoin' })).toThrow(/not allowed/);
  });

  it('holds exactly the v2 catalog: 20 events and 6 prop keys', () => {
    expect(ANALYTICS_EVENTS).toEqual([
      'app_opened',
      'wallet_created',
      'wallet_recovered',
      'first_send_completed',
      'send_completed',
      'nft_viewed',
      'nft_sent',
      'network_switched',
      'wallet_switched',
      'address_book_used',
      'powerup_installed',
      'powerup_uninstalled',
      'swap_completed',
      'first_swap_completed',
      'memo_sent',
      'payment_request_created',
      'payment_request_paid',
      'dapp_connected',
      'dapp_message_signed',
      'dapp_transaction_signed',
    ]);
    expect(ALLOWED_PROP_KEYS).toEqual(['chain', 'from_chain', 'to_chain', 'success', 'powerup']);
  });

  it('accepts only registry Powerup ids in powerup', () => {
    expect(POWERUPS).toEqual(['swap', 'payments', 'memo', 'skr', 'dagon']);
    expect(validateEvent('powerup_installed', { powerup: 'swap' })).toEqual({
      event: 'powerup_installed',
      props: { powerup: 'swap' },
    });
    expect(() => validateEvent('powerup_installed', { powerup: 'staking' })).toThrow(/not allowed/);
  });

  it('accepts success only as a boolean', () => {
    expect(validateEvent('memo_sent', { success: false }).props).toEqual({ success: false });
    expect(() => validateEvent('memo_sent', { success: 'true' })).toThrow(/not allowed/);
  });

  it('safeValidateEvent returns null instead of throwing', () => {
    expect(safeValidateEvent('nope')).toBeNull();
  });
});
