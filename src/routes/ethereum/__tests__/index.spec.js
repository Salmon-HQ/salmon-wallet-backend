'use strict';

const ethereumRouter = require('..');

describe('ethereum router skeleton', () => {
  it('exports an Express router', () => {
    expect(typeof ethereumRouter).toBe('function');
    expect(typeof ethereumRouter.use).toBe('function');
  });

  it('does not register any HTTP routes (skeleton state)', () => {
    // The router stack only carries Express-internal layers when no
    // route is registered. Once the slice gains real endpoints this
    // test should be replaced with explicit route assertions.
    const stack = ethereumRouter.stack || [];
    const userRoutes = stack.filter((layer) => layer.route);
    expect(userRoutes).toHaveLength(0);
  });
});
