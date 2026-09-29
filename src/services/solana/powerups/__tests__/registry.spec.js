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
