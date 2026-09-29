'use strict';

const powerupGate = require('../powerup-gate');

describe('powerup-gate', () => {
  it('is a pass-through until spec 011 lands', () => {
    const next = jest.fn();

    powerupGate({}, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
