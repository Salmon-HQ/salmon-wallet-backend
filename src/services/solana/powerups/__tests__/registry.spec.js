'use strict';

const { POWERUPS } = require('../registry');

describe('powerups registry', () => {
  it('lists payments as a read-only core Powerup on both Solana networks', () => {
    expect(POWERUPS.payments).toEqual({
      tier: 'core',
      networks: ['solana-mainnet', 'solana-devnet'],
      contributor: null,
      endpoints: [],
    });
    expect(POWERUPS.payments.adapter).toBeUndefined();
  });

  it.each(['local', 'develop', 'main', 'prod'])('stage %s offers payments', (stage) => {
    const config = require(`../../../../network-capabilities/network-capabilities-${stage}`);
    expect(config.powerups.payments).toEqual({ enabled: true });
  });
});

describe('the SKR Powerup (spec 021)', () => {
  it('is a read-only core Powerup on mainnet, where SKR staking exists', () => {
    expect(POWERUPS.skr).toEqual({
      tier: 'core',
      networks: ['solana-mainnet'],
      contributor: null,
      endpoints: [],
    });
  });

  it.each(['local', 'staging', 'prod'])('is offered on %s', (stage) => {
    const config = require(`../../../../network-capabilities/network-capabilities-${stage}`);
    expect(config.powerups.skr).toEqual({ enabled: true });
  });

  it.each(['develop', 'main'])('is not offered on %s', (stage) => {
    const config = require(`../../../../network-capabilities/network-capabilities-${stage}`);
    expect(config.powerups.skr).toBeUndefined();
  });
});
