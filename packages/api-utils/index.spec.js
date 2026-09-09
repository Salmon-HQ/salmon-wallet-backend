const { decorator } = require('./index');

describe('Api Utils', () => {
  test('Should support null object', () => {
    decorator({}, null, {}).then((result) => expect(result).toBeNull());
  });

  test('drops prototype-chain keys from ?include= instead of assigning them', async () => {
    let seenInclude;
    const decorate = async (item, include) => {
      seenInclude = include;
      return item;
    };
    const req = { query: { include: '__proto__.polluted,constructor.prototype.x,items' } };

    await decorator(decorate, { id: 1 }, { req });

    expect(seenInclude).toEqual({ items: {} });
    expect({}.polluted).toBeUndefined();
    expect({}.x).toBeUndefined();
  });
});
