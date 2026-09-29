'use strict';

const mockRouter = {
  get: jest.fn(),
  post: jest.fn(),
};

jest.mock('express', () => ({
  Router: jest.fn(() => mockRouter),
}));
jest.mock('../../../../packages/api-utils', () => ({
  safe: jest.fn((handler) => ({ type: 'safe', handler })),
}));
jest.mock('../../../middlewares/powerup-gate', () => 'powerupGate');
jest.mock('../../../controllers/solana/solana-powerups-controller', () => ({ build: 'build' }));

describe('solana-powerups-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
    mockRouter.post.mockClear();
  });

  it('registers the build as a GET behind the gate and no execute route (signing boundary)', () => {
    require('../solana-powerups-router');

    expect(mockRouter.get).toHaveBeenCalledWith('/:id/build', 'powerupGate', {
      type: 'safe',
      handler: 'build',
    });
    expect(mockRouter.post).not.toHaveBeenCalled();
  });
});
