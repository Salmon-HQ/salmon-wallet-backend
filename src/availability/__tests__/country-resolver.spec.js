'use strict';

const {
  countryOf,
  countryOfRequest,
  databaseBuiltAt,
  resetCountryDatabase,
} = require('../country-resolver');

describe('availability/country-resolver', () => {
  // The packaged test database was built on 2026-06-01; on prod it counts as
  // fresh only for 45 days after that.
  const FRESH_DAY = new Date('2026-06-20T00:00:00Z');

  const { STAGE } = process.env;

  afterEach(() => {
    delete process.env.AVAILABILITY_COUNTRY_OVERRIDE;
    delete process.env.NODE_ENV;
    if (STAGE === undefined) delete process.env.STAGE;
    else process.env.STAGE = STAGE;
    jest.useRealTimers();
    resetCountryDatabase();
  });

  it('resolves a public IPv4 address to its ISO country', () => {
    expect(countryOf('8.8.8.8')).toBe('US');
  });

  it('resolves a public IPv6 address', () => {
    expect(countryOf('2001:4860:4860::8888')).toEqual(expect.stringMatching(/^[A-Z]{2}$/));
  });

  it.each(['10.0.0.1', '127.0.0.1', 'not-an-ip', '', undefined, null])(
    'answers null for %p',
    (ip) => {
      expect(countryOf(ip)).toBeNull();
    }
  );

  describe('Ukrainian regions the gate treats on their own (ISO 3166-2)', () => {
    it('answers UA-43 for a Crimean address DB-IP files under RU', () => {
      expect(countryOf('5.3.41.7')).toBe('UA-43');
      expect(countryOf('46.172.192.10')).toBe('UA-43');
    });

    it('answers the region for a Donetsk address filed under UA', () => {
      expect(countryOf('5.105.214.20')).toBe('UA-14');
    });

    it('matches IPv6 ranges too', () => {
      expect(countryOf('2001:678:128::1')).toBe('UA-43');
      expect(countryOf('2001:678:2d0::5')).toBe('UA-65');
    });

    it('keeps the rest of Ukraine as UA', () => {
      expect(countryOf('2.21.89.10')).toBe('UA');
    });
  });

  // An IPv4 address written as IPv6 must still meet the region ranges.
  it('reads an IPv4-mapped IPv6 address as the IPv4 it carries', () => {
    expect(countryOf('::ffff:5.3.41.10')).toBe(countryOf('5.3.41.10'));
    expect(countryOf('::ffff:8.8.8.8')).toBe('US');
  });

  describe('behind a CloudFront distribution of ours', () => {
    const request = (via) => ({
      requestContext: { identity: { sourceIp: '8.8.8.8' } },
      headers: via === undefined ? {} : { via },
    });

    it("places a request through API Gateway's own edge only", () => {
      expect(countryOfRequest(request('2.0 abc.cloudfront.net (CloudFront)'))).toBe('US');
      expect(countryOfRequest(request())).toBe('US');
    });

    // The source address is then the CloudFront server, which can sit in
    // another country than the caller: a way around the country gate.
    it('places nobody once a second CloudFront hop shows the source is a proxy', () => {
      expect(
        countryOfRequest(
          request('1.1 a.cloudfront.net (CloudFront), 1.1 b.cloudfront.net (CloudFront)')
        )
      ).toBeNull();
    });
  });

  it('reads the source address API Gateway attached to the request', () => {
    const req = { requestContext: { identity: { sourceIp: '8.8.8.8' } }, headers: {} };
    expect(countryOfRequest(req)).toBe('US');
  });

  it('honours the local override outside prod', () => {
    process.env.NODE_ENV = 'local';
    process.env.AVAILABILITY_COUNTRY_OVERRIDE = 'cu';
    const req = { requestContext: { identity: { sourceIp: '8.8.8.8' } }, headers: {} };
    expect(countryOfRequest(req)).toBe('CU');
  });

  it('ignores the override on prod', () => {
    jest.useFakeTimers({ now: FRESH_DAY });
    process.env.NODE_ENV = 'prod';
    process.env.AVAILABILITY_COUNTRY_OVERRIDE = 'CU';
    const req = { requestContext: { identity: { sourceIp: '8.8.8.8' } }, headers: {} };
    expect(countryOfRequest(req)).toBe('US');
  });

  it('refuses with 503 when the database cannot be opened, instead of answering "no country"', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => {
          throw new Error('ENOENT');
        },
      }));
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const broken = require('../country-resolver');
      expect(() => broken.countryOf('8.8.8.8')).toThrow(
        expect.objectContaining({ statusCode: 503, errorCode: 'upstream_unavailable' })
      );
      expect(() => broken.countryOf('8.8.8.8')).toThrow(/unavailable/);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('[COUNTRY_DB_UNAVAILABLE]', expect.any(Object));
      error.mockRestore();
    });
  });

  describe('a stale database', () => {
    const staleDay = () => new Date(databaseBuiltAt().getTime() + 46 * 24 * 60 * 60 * 1000);

    // IP blocks change country every month: past 45 days the gate must not
    // trust an old answer, so nobody is placed and regulated capabilities close.
    it('places nobody on prod once the database is older than 45 days', () => {
      jest.useFakeTimers({ now: staleDay() });
      process.env.STAGE = 'prod';
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(countryOf('8.8.8.8')).toBeNull();
      expect(countryOf('8.8.4.4')).toBeNull();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('[COUNTRY_DB_STALE]', expect.any(Object));
      error.mockRestore();
    });

    // Staging builds real mainnet swaps, so its country gate holds to the
    // same rule; it is keyed on the stage, not on NODE_ENV.
    it('places nobody on staging either once the database is older than 45 days', () => {
      jest.useFakeTimers({ now: staleDay() });
      process.env.STAGE = 'staging';
      process.env.NODE_ENV = 'staging';
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(countryOf('8.8.8.8')).toBeNull();
      error.mockRestore();
    });

    // A prod NODE_ENV holds to the rule even if STAGE were missing.
    it('places nobody once the database is older than 45 days when NODE_ENV is prod', () => {
      jest.useFakeTimers({ now: staleDay() });
      delete process.env.STAGE;
      process.env.NODE_ENV = 'prod';
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(countryOf('8.8.8.8')).toBeNull();
      error.mockRestore();
    });

    it('still places addresses on prod within 45 days', () => {
      jest.useFakeTimers({ now: FRESH_DAY });
      process.env.STAGE = 'prod';
      expect(countryOf('8.8.8.8')).toBe('US');
    });

    it.each([['local'], [undefined]])(
      'is not enforced on stage %s, where the packaged copy is old',
      (stage) => {
        jest.useFakeTimers({ now: new Date('2027-01-01T00:00:00Z') });
        if (stage) process.env.STAGE = stage;
        else delete process.env.STAGE;
        expect(countryOf('8.8.8.8')).toBe('US');
      }
    );
  });

  it("reads DB-IP's own record shape, the one deploys download", () => {
    jest.isolateModules(() => {
      // The 503 test above leaves its broken `fs` mock registered.
      jest.doMock('fs', () => jest.requireActual('fs'));
      jest.doMock('mmdb-lib', () => ({
        Reader: class {
          constructor() {
            this.metadata = { buildEpoch: new Date() };
          }
          get() {
            return { country: { iso_code: 'GB' } };
          }
        },
      }));
      const resolver = require('../country-resolver');
      expect(resolver.countryOf('81.2.69.142')).toBe('GB');
    });
  });
});
