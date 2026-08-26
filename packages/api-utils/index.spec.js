const { decorator } = require('./index');

describe('Api Utils', () => {
  test('Should support null object', () => {
    decorator({}, null, {}).then((result) => expect(result).toBeNull());
  });
});
