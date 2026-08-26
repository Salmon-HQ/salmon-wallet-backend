'use strict';

/**
 * Invariant: every chain that the multichain balance endpoint exposes
 * MUST also be in the global BLOCKCHAINS registry. Otherwise the
 * chain-mount loop in src/index.js would not mount that chain's slice
 * router and the balance request would 404 even though account-router
 * advertises it.
 */

const capturedMultinetworkOptions = [];

jest.mock('express', () => ({
  Router: jest.fn(() => ({ get: jest.fn() })),
}));
jest.mock('../../../middlewares/multinetwork', () =>
  jest.fn((options) => {
    capturedMultinetworkOptions.push(options);
    return 'multinetwork';
  })
);
jest.mock('../../../../packages/api-utils', () => ({
  safe: jest.fn((handler) => handler),
}));
jest.mock('../../../../packages/middleware', () => ({
  cacheControl: jest.fn(() => 'cacheControl'),
}));
jest.mock('../../../controllers/multichain/account-controller', () => ({
  showBalance: jest.fn(),
}));

describe('multichain account-router invariants', () => {
  beforeEach(() => {
    jest.resetModules();
    capturedMultinetworkOptions.length = 0;
  });

  it('every chain in the balance allowlist is also in BLOCKCHAINS', () => {
    require('../account-router');
    const { BLOCKCHAINS } = require('../../../constants/blockchains');

    expect(capturedMultinetworkOptions).toHaveLength(1);
    const balanceChains = capturedMultinetworkOptions[0].blockchains;
    expect(Array.isArray(balanceChains)).toBe(true);

    balanceChains.forEach((chain) => {
      expect(BLOCKCHAINS).toContain(chain);
    });
  });
});
