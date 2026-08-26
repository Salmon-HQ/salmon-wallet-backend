const RedisConnector = require('./index');
// Use environment variable or default to 'redis' (Docker service name)
const TEST_HOST = process.env.REDIS_HOST || 'redis';
const TEST_KEY = 'key';
const TEST_VALUE = 'some value';
const TEST_TTL = 60; // in seconds

describe('Ok operations ', () => {
  const settings = {
    socket: {
      host: TEST_HOST,
    },
  };
  const connector = RedisConnector(settings);

  afterAll(async () => await connector.quit());

  test('set key without ttl', () =>
    expect(connector.set(TEST_KEY, TEST_VALUE)).resolves.toBe('OK'));

  test('set key with ttl', () =>
    expect(connector.set(TEST_KEY, TEST_VALUE, { ex: TEST_TTL })).resolves.toBe('OK'));

  test('retrieve key', async () => {
    const keyName = `${TEST_KEY}_0`;

    await connector.set(keyName, TEST_VALUE, { ex: TEST_TTL });

    return expect(connector.get(keyName)).resolves.toBe(TEST_VALUE);
  });

  test('retrieve unexisting key', async () => {
    const keyName = `${TEST_KEY}_A`;

    return expect(connector.get(keyName)).resolves.toBe(null);
  });

  test('remove key', async () => {
    const keyName = `${TEST_KEY}_00`;

    await connector.set(keyName, TEST_VALUE, { ex: TEST_TTL });

    return expect(connector.del(keyName)).resolves.toBe(1 /* the number of removed keys */);
  });

  test('remove multiple keys', async () => {
    const key1 = `${TEST_KEY}_1`;
    await connector.set(key1, TEST_VALUE, { ex: TEST_TTL });

    const key2 = `${TEST_KEY}_2`;
    await connector.set(key2, TEST_VALUE, { ex: TEST_TTL });

    return expect(connector.del([key1, key2])).resolves.toBe(2 /* the number of removed keys */);
  });

  test('scan keys', async () => {
    const PREFIX = 'SERV1_';

    const key1 = `${PREFIX}${TEST_KEY}_00`;
    await connector.set(key1, TEST_VALUE, { ex: TEST_TTL });

    const key2 = `${PREFIX}${TEST_KEY}_01`;
    await connector.set(key2, TEST_VALUE, { ex: TEST_TTL });

    const key3 = `SERV2_${TEST_KEY}_00`;
    await connector.set(key3, TEST_VALUE, { ex: TEST_TTL });

    const pattern = `${PREFIX}*`;

    // SCAN is non-deterministic — iterate until cursor returns to 0
    let allKeys = [];
    let cursor = '0';
    do {
      const result = await connector.scan(cursor, { pattern });
      expect(result).toHaveProperty('cursor');
      expect(result).toHaveProperty('keys');
      cursor = String(result.cursor);
      allKeys = allKeys.concat(result.keys);
    } while (cursor !== '0');

    expect(allKeys).toEqual(expect.arrayContaining([key1, key2]));
    expect(allKeys).toHaveLength(2);
  });
});
