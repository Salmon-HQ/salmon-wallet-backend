'use strict';

jest.mock('../../../constants/networks', () => [
  { id: 'solana-mainnet', blockchain: 'solana', environment: 'mainnet' },
  { id: 'bitcoin-mainnet', blockchain: 'bitcoin', environment: 'mainnet' },
]);

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const loadService = () => {
  jest.resetModules();
  return require('../network-capabilities-service');
};

describe('network-capabilities-service', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  test('exposes the supported stage list', () => {
    const service = loadService();
    expect(service.SUPPORTED_STAGES).toEqual(['develop', 'local', 'main', 'prod']);
  });

  test('returns undefined and logs a loud error when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;

    const service = loadService();
    const result = service.get();

    expect(result).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('NODE_ENV is ""'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('All networks will report enabled=false')
    );
  });

  test('returns undefined and logs a loud error when NODE_ENV is an unknown stage', () => {
    process.env.NODE_ENV = 'staging';

    const service = loadService();
    const result = service.get();

    expect(result).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('NODE_ENV is "staging"'));
  });

  test('loads the capabilities file for a supported stage', () => {
    process.env.NODE_ENV = 'local';

    jest.doMock(
      '../../../network-capabilities/network-capabilities-local',
      () => ({ overview: { active: true } }),
      { virtual: true }
    );

    const service = loadService();
    const result = service.get();

    expect(result).toEqual({
      'solana-mainnet': expect.objectContaining({ overview: expect.any(Object) }),
      'bitcoin-mainnet': expect.objectContaining({ overview: expect.any(Object) }),
    });
  });

  test('returns undefined and logs when the capabilities file cannot be required', () => {
    process.env.NODE_ENV = 'develop';

    jest.doMock(
      '../../../network-capabilities/network-capabilities-develop',
      () => {
        throw new Error('boom');
      },
      { virtual: true }
    );

    const service = loadService();
    const result = service.get();

    expect(result).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load network-capabilities-develop')
    );
  });
});

describe('network-capabilities-service powerups', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NODE_ENV = 'local';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  const stage = (powerups) =>
    jest.doMock(
      '../../../network-capabilities/network-capabilities-local',
      () => ({ enable: ['solana-mainnet'], powerups }),
      { virtual: true }
    );

  test('returns the validated powerups block and keeps it out of the network map', () => {
    stage({ swap: { enabled: true }, stake: { enabled: false, reason: 'maintenance' } });

    const service = loadService();

    expect(service.getPowerups()).toEqual({
      swap: { enabled: true },
      stake: { enabled: false, reason: 'maintenance' },
    });
    expect(service.get()['solana-mainnet']).toEqual({ enable: true });
  });

  test('defaults to an empty block when the stage declares no powerups', () => {
    stage(undefined);

    expect(loadService().getPowerups()).toEqual({});
  });

  test.each([
    ['an unknown reason', { swap: { enabled: false, reason: 'typo' } }],
    ['a non-boolean enabled', { swap: { enabled: 'yes' } }],
  ])('fails loudly on %s', (_label, powerups) => {
    stage(powerups);

    expect(loadService().getPowerups()).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid powerups config for swap')
    );
  });

  test('returns undefined when the stage itself is misconfigured', () => {
    process.env.NODE_ENV = 'staging';

    expect(loadService().getPowerups()).toBeUndefined();
  });
});
