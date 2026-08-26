'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../dapp-url-guard', () => {
  const actual = jest.requireActual('../dapp-url-guard');
  return { ...actual, assertFetchableUrl: jest.fn() };
});

const http = require('axios');
const { assertFetchableUrl, DappUrlError } = require('../dapp-url-guard');
const { getMetadata, extractOpenGraphTags } = require('../dapp-service');

const htmlWith = (tags) => `<!doctype html><html><head>${tags}</head><body>ignored</body></html>`;

const ok = (html) => ({ status: 200, data: html, headers: {} });

describe('dapp-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assertFetchableUrl.mockImplementation(async (url) => ({
      url: new URL(url),
      address: '93.184.216.34',
      family: 4,
    }));
  });

  describe('extractOpenGraphTags', () => {
    it('reads property and name meta tags, keeping the first occurrence', () => {
      const tags = extractOpenGraphTags(
        htmlWith(
          `<meta property="og:site_name" content="Salmon">
           <meta name="og:image" content="https://cdn.example/icon.png">
           <meta property="og:site_name" content="Impostor">`
        )
      );

      expect(tags['og:site_name']).toBe('Salmon');
      expect(tags['og:image']).toBe('https://cdn.example/icon.png');
    });

    it('returns an empty object for HTML without meta tags', () => {
      expect(extractOpenGraphTags('<html><body>hi</body></html>')).toEqual({});
    });
  });

  describe('getMetadata', () => {
    it('returns name from og:site_name and icon from og:image', async () => {
      http.get.mockResolvedValue(
        ok(
          htmlWith(
            `<meta property="og:site_name" content="Salmon">
             <meta property="og:image" content="https://example.com/icon.png">`
          )
        )
      );

      await expect(getMetadata('https://salmon.example/')).resolves.toEqual({
        name: 'Salmon',
        icon: 'https://example.com/icon.png',
      });
    });

    it('falls back to og:title when og:site_name is missing', async () => {
      http.get.mockResolvedValue(
        ok(htmlWith(`<meta property="og:title" content="Salmon Wallet">`))
      );

      await expect(getMetadata('https://salmon.example/')).resolves.toEqual({
        name: 'Salmon Wallet',
        icon: undefined,
      });
    });

    it('bounds the request in time and size and never auto-follows redirects', async () => {
      http.get.mockResolvedValue(ok(htmlWith('')));

      await getMetadata('https://salmon.example/');

      expect(http.get).toHaveBeenCalledWith(
        'https://salmon.example/',
        expect.objectContaining({ timeout: 5000, maxRedirects: 0, maxContentLength: 1024 * 1024 })
      );
    });

    it('drops an icon that is not absolute https', async () => {
      http.get.mockResolvedValue(
        ok(htmlWith(`<meta property="og:image" content="http://example.com/icon.png">`))
      );

      await expect(getMetadata('https://salmon.example/')).resolves.toMatchObject({
        icon: undefined,
      });
    });

    it('caps an attacker-controlled name', async () => {
      http.get.mockResolvedValue(
        ok(htmlWith(`<meta property="og:site_name" content="${'A'.repeat(500)}">`))
      );

      const { name } = await getMetadata('https://salmon.example/');

      expect(name).toHaveLength(64);
    });

    it('pins the connection to the address the guard validated', async () => {
      http.get.mockResolvedValue(ok(htmlWith('')));

      await getMetadata('https://salmon.example/');

      const { lookup } = http.get.mock.calls[0][1];
      expect(lookup('salmon.example', { all: true })).toEqual([
        { address: '93.184.216.34', family: 4 },
      ]);
    });

    it('re-pins each redirect hop to its own validated address', async () => {
      assertFetchableUrl
        .mockResolvedValueOnce({
          url: new URL('https://salmon.example/'),
          address: '1.1.1.1',
          family: 4,
        })
        .mockResolvedValueOnce({
          url: new URL('https://other.example/'),
          address: '2.2.2.2',
          family: 4,
        });
      http.get
        .mockResolvedValueOnce({ status: 302, headers: { location: 'https://other.example/' } })
        .mockResolvedValueOnce(ok(htmlWith('')));

      await getMetadata('https://salmon.example/');

      expect(http.get.mock.calls[0][1].lookup()).toEqual([{ address: '1.1.1.1', family: 4 }]);
      expect(http.get.mock.calls[1][1].lookup()).toEqual([{ address: '2.2.2.2', family: 4 }]);
    });

    it('re-validates a redirect target before following it', async () => {
      http.get
        .mockResolvedValueOnce({ status: 302, headers: { location: 'https://other.example/' } })
        .mockResolvedValueOnce(ok(htmlWith(`<meta property="og:site_name" content="Other">`)));

      await expect(getMetadata('https://salmon.example/')).resolves.toMatchObject({
        name: 'Other',
      });
      expect(assertFetchableUrl).toHaveBeenCalledWith('https://other.example/');
    });

    it('refuses a redirect that points at a blocked address', async () => {
      http.get.mockResolvedValueOnce({
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      });
      assertFetchableUrl
        .mockImplementationOnce(async (url) => ({
          url: new URL(url),
          address: '1.2.3.4',
          family: 4,
        }))
        .mockRejectedValueOnce(
          new DappUrlError('The url query parameter points to a non-public address.')
        );

      await expect(getMetadata('https://salmon.example/')).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it('stops after too many redirects', async () => {
      http.get.mockResolvedValue({ status: 302, headers: { location: 'https://loop.example/' } });

      await expect(getMetadata('https://salmon.example/')).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'dapp_unreachable',
      });
    });

    it('never leaks the transport error, so the endpoint cannot be used as a port scanner', async () => {
      http.get.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:22'));

      await expect(getMetadata('https://salmon.example/')).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'dapp_unreachable',
        message: 'The dapp could not be reached.',
      });
    });

    it('propagates the guard rejection for a missing url', async () => {
      assertFetchableUrl.mockRejectedValue(
        new DappUrlError('Missing url query parameter', 'missing_parameter')
      );

      await expect(getMetadata(undefined)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'missing_parameter',
      });
      expect(http.get).not.toHaveBeenCalled();
    });
  });
});
