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

describe('the Dagon Powerup (spec 023)', () => {
  const dagon = require('../adapters/dagon');

  it('is a core transaction-building Powerup on devnet that declares its fresh signers', () => {
    expect(POWERUPS.dagon).toEqual({
      tier: 'core',
      networks: ['solana-devnet'],
      contributor: null,
      programIds: [
        '3kjJEx6G1XdrtixFg9f8eGRAyzW5QmhsJQq6qCUZYhXZ',
        'BqJMtWQYiis1264KqBN3wssNqTofK5RuP67hkZYvb4SD',
        '4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        '11111111111111111111111111111111',
      ],
      lookupTables: [],
      freshSigners: {
        setup: 1,
        wrap: 1,
        reveal: 1,
        send: 0,
        swap: 1,
        unwrapBurn: 1,
        unwrapDecrypt: 1,
        unwrapComplete: 0,
      },
      errorCodes: ['invalid_fresh_signers'],
      adapter: dagon,
    });
  });

  it('is the only entry that declares fresh signers', () => {
    const declaring = Object.keys(POWERUPS).filter((id) => POWERUPS[id].freshSigners);
    expect(declaring).toEqual(['dagon']);
  });

  it.each(['staging', 'local'])('is offered on %s', (stage) => {
    const config = require(`../../../../network-capabilities/network-capabilities-${stage}`);
    expect(config.powerups.dagon).toEqual({ enabled: true });
  });

  it.each(['prod', 'main', 'develop'])('is not offered on %s', (stage) => {
    const config = require(`../../../../network-capabilities/network-capabilities-${stage}`);
    expect(config.powerups.dagon).toBeUndefined();
  });
});
