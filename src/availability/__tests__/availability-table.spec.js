'use strict';

const {
  DEFAULT_TABLE,
  JUPITER_PROHIBITED,
  validateTable,
  createTableLoader,
} = require('../availability-table');

const valid = () => JSON.parse(JSON.stringify(DEFAULT_TABLE));

describe('availability-table', () => {
  afterEach(() => {
    delete process.env.AVAILABILITY_TABLE_JSON;
    delete process.env.NODE_ENV;
    jest.restoreAllMocks();
  });

  describe('DEFAULT_TABLE', () => {
    it('is the spec owner decision 3: embargoed + US unavailable, Jupiter list on 0x, Jupiter default', () => {
      const swap = DEFAULT_TABLE.capabilities.swap;
      expect(swap.default).toBe('jupiter');
      expect(swap.unavailable).toEqual(expect.arrayContaining(['CU', 'IR', 'KP', 'SY', 'US']));
      expect(swap.providers['0x']).toEqual(expect.arrayContaining(['CN', 'SG', 'NI', 'ZW']));
      expect(validateTable(DEFAULT_TABLE)).toEqual([]);
    });

    it('never names Jupiter for a country Jupiter prohibits', () => {
      const swap = DEFAULT_TABLE.capabilities.swap;
      const jupiterServed = (country) =>
        !swap.unavailable.includes(country) && !(swap.providers['0x'] || []).includes(country);
      expect(JUPITER_PROHIBITED.filter(jupiterServed)).toEqual([]);
    });
  });

  describe('validateTable', () => {
    it('rejects an unknown provider', () => {
      const t = valid();
      t.capabilities.swap.default = 'raydium';
      expect(validateTable(t)).toContainEqual(expect.stringContaining('raydium'));
    });

    it('rejects a Jupiter row for a prohibited country, including via platform override', () => {
      const t = valid();
      t.capabilities.swap.unavailable = t.capabilities.swap.unavailable.filter((c) => c !== 'US');
      t.capabilities.swap.providers.jupiter = ['US'];
      expect(validateTable(t)).toContainEqual(expect.stringContaining('US'));

      const u = valid();
      u.capabilities.swap.platforms.android = { unavailable: [] };
      const problems = validateTable(u);
      expect(problems).toHaveLength(5);
      expect(problems).toContainEqual('swap.platforms.android: Jupiter may not serve US');
    });

    it('rejects an unknown platform key and a bad version', () => {
      const t = valid();
      t.capabilities.swap.platforms.web = {};
      expect(validateTable(t)).toContainEqual(expect.stringContaining('web'));
      const v = valid();
      v.version = 2;
      expect(validateTable(v)).toEqual([expect.stringContaining('version')]);
    });

    it('rejects a country code that is not two upper-case letters', () => {
      const t = valid();
      t.capabilities.swap.unavailable.push('usa');
      expect(validateTable(t)).toContainEqual(expect.stringContaining('usa'));
    });
  });

  describe('createTableLoader', () => {
    it('serves the built-in default when nothing is configured', async () => {
      const load = createTableLoader({ fetchParameter: jest.fn() });
      expect(await load()).toEqual(DEFAULT_TABLE);
    });

    it('prefers AVAILABILITY_TABLE_JSON outside prod', async () => {
      const t = valid();
      t.capabilities.swap.unavailable.push('AR');
      process.env.NODE_ENV = 'local';
      process.env.AVAILABILITY_TABLE_JSON = JSON.stringify(t);
      const load = createTableLoader({ fetchParameter: jest.fn() });
      expect((await load()).capabilities.swap.unavailable).toContain('AR');
    });

    it('ignores AVAILABILITY_TABLE_JSON on prod', async () => {
      process.env.NODE_ENV = 'prod';
      process.env.AVAILABILITY_TABLE_JSON = JSON.stringify({ version: 1, capabilities: {} });
      const load = createTableLoader({ fetchParameter: jest.fn().mockResolvedValue(null) });
      expect(await load()).toEqual(DEFAULT_TABLE);
    });

    it('reads the SSM parameter, caches it, and keeps the last good copy on failure', async () => {
      const t = valid();
      t.capabilities.swap.unavailable.push('AR');
      const fetchParameter = jest
        .fn()
        .mockResolvedValueOnce(JSON.stringify(t))
        .mockRejectedValueOnce(new Error('ssm down'));
      let now = 0;
      const load = createTableLoader({ fetchParameter, now: () => now, ttlMs: 1000 });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      expect((await load()).capabilities.swap.unavailable).toContain('AR');
      expect((await load()).capabilities.swap.unavailable).toContain('AR');
      expect(fetchParameter).toHaveBeenCalledTimes(1);

      now = 2000;
      expect((await load()).capabilities.swap.unavailable).toContain('AR');
      expect(fetchParameter).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledWith(
        '[AVAILABILITY_TABLE]',
        expect.objectContaining({ outcome: 'fetch_failed' })
      );
    });

    it('keeps the previous table when the document is invalid, and logs it', async () => {
      const bad = valid();
      bad.capabilities.swap.default = 'raydium';
      const fetchParameter = jest.fn().mockResolvedValue(JSON.stringify(bad));
      const load = createTableLoader({ fetchParameter, now: () => 0 });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(await load()).toEqual(DEFAULT_TABLE);
      expect(console.error).toHaveBeenCalledWith(
        '[AVAILABILITY_TABLE]',
        expect.objectContaining({ outcome: 'invalid' })
      );
    });
  });
});
