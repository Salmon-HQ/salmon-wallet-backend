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
jest.mock('../../../middlewares/powerup-gate', () => jest.fn((capability) => `gate:${capability}`));
jest.mock('../../../controllers/solana/solana-powerups-controller', () => ({
  build: 'build',
  availability: 'availability',
}));

describe('solana-powerups-router', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRouter.get.mockClear();
    mockRouter.post.mockClear();
  });

  it('registers the build as a GET behind the gate and no execute route (signing boundary)', () => {
    require('../solana-powerups-router');

    expect(mockRouter.get).toHaveBeenCalledWith('/:id/build', 'gate:param', {
      type: 'safe',
      handler: 'build',
    });
    expect(mockRouter.post).not.toHaveBeenCalled();
  });

  it('registers /availability before /:id/build so the literal path wins', () => {
    require('../solana-powerups-router');

    const paths = mockRouter.get.mock.calls.map(([path]) => path);
    expect(paths.indexOf('/availability')).toBeLessThan(paths.indexOf('/:id/build'));
    expect(mockRouter.get).toHaveBeenCalledWith('/availability', {
      type: 'safe',
      handler: 'availability',
    });
  });
});
