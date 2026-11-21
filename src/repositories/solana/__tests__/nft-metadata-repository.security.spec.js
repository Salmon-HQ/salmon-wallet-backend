'use strict';

/**
 * Abuse case: server-side request forgery (SSRF) through an NFT's metadata
 * URI. Anyone can mint an NFT whose `json_uri` names a host they control and
 * answer its DNS lookup with an internal address. The guard reads the address
 * the resolver returned, so it must read every spelling of it: an IPv4
 * address is also valid as IPv4-mapped IPv6, dotted or in hex groups.
 * Reported privately as GHSA-f2w5-qjrj-vxfm.
 */

const fc = require('fast-check');
const { isBlockedIp } = require('../nft-metadata-repository').__testing;

const hexMapped = (ipv4) => {
  const [a, b, c, d] = ipv4.split('.').map(Number);
  return `::ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
};

describe('[API7:2023] abuse: an internal address spelled as IPv4-mapped IPv6', () => {
  test.each([
    ['cloud instance metadata', '::ffff:a9fe:a9fe'],
    ['loopback', '::ffff:7f00:1'],
    ['private class A', '::ffff:a00:1'],
    ['loopback, fully written out', '0:0:0:0:0:ffff:7f00:1'],
    ['loopback, upper case', '::FFFF:7F00:1'],
  ])('%s (%s) is blocked', (_label, address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  test('every IPv4 address gets one answer in all three spellings', () => {
    fc.assert(
      fc.property(fc.ipV4(), (ipv4) => {
        const answer = isBlockedIp(ipv4);
        expect(isBlockedIp(`::ffff:${ipv4}`)).toBe(answer);
        expect(isBlockedIp(hexMapped(ipv4))).toBe(answer);
      }),
      { numRuns: 1000 }
    );
  });

  test('a public address stays reachable in its mapped form', () => {
    expect(isBlockedIp('::ffff:808:808')).toBe(false);
  });
});
