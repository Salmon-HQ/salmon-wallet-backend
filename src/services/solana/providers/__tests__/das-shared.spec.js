'use strict';

const { transformDasAsset } = require('../das-shared');

const asset = (grouping) => ({ id: 'Mint111', content: {}, grouping });

describe('transformDasAsset collection.verified', () => {
  test('is null without a collection grouping', () => {
    expect(transformDasAsset(asset([]), 'o').collection).toBeNull();
  });

  test('is true when the provider omits the flag (default calls list verified only)', () => {
    expect(
      transformDasAsset(asset([{ group_key: 'collection', group_value: 'Coll1' }]), 'o').collection
    ).toEqual({ key: 'Coll1', verified: true });
  });

  test('is true when the provider reports verified: true', () => {
    expect(
      transformDasAsset(
        asset([{ group_key: 'collection', group_value: 'Coll1', verified: true }]),
        'o'
      ).collection.verified
    ).toBe(true);
  });

  test('is false when the provider reports verified: false', () => {
    expect(
      transformDasAsset(
        asset([{ group_key: 'collection', group_value: 'Coll1', verified: false }]),
        'o'
      ).collection.verified
    ).toBe(false);
  });
});
