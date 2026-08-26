'use strict';

jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));

const dns = require('dns').promises;
const { assertFetchableUrl, isBlockedAddress, DappUrlError } = require('../dapp-url-guard');

describe('dapp-url-guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  describe('isBlockedAddress', () => {
    it.each([
      ['loopback v4', '127.0.0.1'],
      ['private 10/8', '10.0.0.1'],
      ['private 172.16/12', '172.20.10.5'],
      ['private 192.168/16', '192.168.1.1'],
      ['cloud metadata', '169.254.169.254'],
      ['CGNAT', '100.64.0.1'],
      ['unspecified', '0.0.0.0'],
      ['multicast', '239.1.1.1'],
      ['loopback v6', '::1'],
      ['unique local v6', 'fd00::1'],
      ['link local v6', 'fe80::1'],
      ['ipv4-mapped private', '::ffff:10.0.0.1'],
      ['not an ip', 'example.com'],
    ])('blocks %s', (_label, address) => {
      expect(isBlockedAddress(address)).toBe(true);
    });

    it.each([
      ['public v4', '93.184.216.34'],
      ['public v6', '2606:2800:220:1:248:1893:25c8:1946'],
      ['ipv4-mapped public', '::ffff:93.184.216.34'],
    ])('allows %s', (_label, address) => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  });

  describe('assertFetchableUrl', () => {
    it('accepts a public https URL', async () => {
      const { url, address, family } = await assertFetchableUrl('https://example.com/app');

      expect(url.hostname).toBe('example.com');
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
      expect(dns.lookup).toHaveBeenCalledWith('example.com', { all: true });
    });

    it('rejects a missing url with a 400 missing_parameter', async () => {
      await expect(assertFetchableUrl(undefined)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'missing_parameter',
      });
    });

    it('rejects a malformed url without resolving it', async () => {
      await expect(assertFetchableUrl('not-a-url')).rejects.toBeInstanceOf(DappUrlError);
      expect(dns.lookup).not.toHaveBeenCalled();
    });

    it.each(['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com'])(
      'rejects the non-http scheme %s',
      async (candidate) => {
        await expect(assertFetchableUrl(candidate)).rejects.toMatchObject({ statusCode: 400 });
        expect(dns.lookup).not.toHaveBeenCalled();
      }
    );

    it('rejects a literal private IP without a DNS lookup', async () => {
      await expect(
        assertFetchableUrl('http://169.254.169.254/latest/meta-data/')
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(dns.lookup).not.toHaveBeenCalled();
    });

    it('rejects a public hostname that resolves to a private address', async () => {
      dns.lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);

      await expect(assertFetchableUrl('https://internal.example.com')).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('rejects when ANY resolved address is private', async () => {
      dns.lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);

      await expect(assertFetchableUrl('https://split.example.com')).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('rejects a host that does not resolve', async () => {
      dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(assertFetchableUrl('https://nope.example.com')).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });
});
