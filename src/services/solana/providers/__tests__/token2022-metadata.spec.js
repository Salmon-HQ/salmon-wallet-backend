'use strict';

const { pickMetadata, resolveToken2022Metadata } = require('../token2022-metadata');

// Shapes recorded from mainnet (jsonParsed) for the Seeker Genesis Token.
const SGT_MINT = '5vPkA3YXK6ByvioKaEyQofqT4QXVWMCXqpvYshswXkCb';
const SGT_GROUP = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
const ISSUER = 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4';
const SGT_URI = 'https://r2.solanamobiledappstore.com/skr/sgt-metadata.json';

const parsed = (extensions) => ({ data: { parsed: { info: { decimals: 0, extensions } } } });

const sgtMint = (group = SGT_GROUP) =>
  parsed([
    { extension: 'metadataPointer', state: { authority: ISSUER, metadataAddress: SGT_GROUP } },
    { extension: 'permanentDelegate', state: { delegate: ISSUER } },
    {
      extension: 'tokenGroupMember',
      state: { group, memberNumber: 14436, mint: SGT_MINT },
    },
  ]);

const sgtGroup = parsed([
  {
    extension: 'tokenMetadata',
    state: {
      mint: SGT_GROUP,
      name: 'Seeker Genesis Token',
      symbol: 'SeekerGT',
      uri: SGT_URI,
      additionalMetadata: [],
      updateAuthority: ISSUER,
    },
  },
  { extension: 'tokenGroup', state: { mint: SGT_GROUP, size: 121148, maxSize: 1000000 } },
]);

const SGT_METADATA = { name: 'Seeker Genesis Token', symbol: 'SeekerGT', uri: SGT_URI };

describe('pickMetadata', () => {
  test("uses the mint's own metadata", () => {
    const mint = parsed([
      { extension: 'metadataPointer', state: { metadataAddress: 'Self111' } },
      {
        extension: 'tokenMetadata',
        state: { name: 'Own', symbol: 'OWN', uri: 'https://x/o.json' },
      },
    ]);
    expect(pickMetadata('Self111', mint, new Map())).toEqual({
      name: 'Own',
      symbol: 'OWN',
      uri: 'https://x/o.json',
    });
  });

  test('follows the pointer to the group the mint is a member of', () => {
    expect(pickMetadata(SGT_MINT, sgtMint(), new Map([[SGT_GROUP, sgtGroup]]))).toEqual(
      SGT_METADATA
    );
  });

  test('refuses a pointer to an account the mint is not a member of', () => {
    // Anyone can point a new mint at the SGT group; only the group's issuer
    // can make it a member.
    expect(
      pickMetadata(SGT_MINT, sgtMint('SomeOtherGroup111'), new Map([[SGT_GROUP, sgtGroup]]))
    ).toBeNull();
  });

  test('is null for a mint without Token-2022 metadata', () => {
    expect(pickMetadata('Plain111', parsed([]), new Map())).toBeNull();
    expect(pickMetadata('Plain111', null, new Map())).toBeNull();
  });
});

describe('resolveToken2022Metadata', () => {
  const connectionWith = (byAddress) => ({
    getMultipleParsedAccounts: jest.fn(async (keys) => ({
      value: keys.map((k) => byAddress[k.toBase58()] ?? null),
    })),
  });

  test('reads the mints, then the groups they point at, in two batched calls', async () => {
    const connection = connectionWith({ [SGT_MINT]: sgtMint(), [SGT_GROUP]: sgtGroup });

    const result = await resolveToken2022Metadata(connection, [SGT_MINT]);

    expect(result.get(SGT_MINT)).toEqual(SGT_METADATA);
    expect(connection.getMultipleParsedAccounts).toHaveBeenCalledTimes(2);
  });

  test('does not read a pointer target the mint is not a member of', async () => {
    const connection = connectionWith({ [SGT_MINT]: sgtMint('SomeOtherGroup111') });

    const result = await resolveToken2022Metadata(connection, [SGT_MINT]);

    expect(result.size).toBe(0);
    expect(connection.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);
  });

  test('answers an empty map when the RPC read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const connection = {
      getMultipleParsedAccounts: jest.fn().mockRejectedValue(new Error('429')),
    };

    await expect(resolveToken2022Metadata(connection, [SGT_MINT])).resolves.toEqual(new Map());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[TOKEN2022_METADATA]'));
    warn.mockRestore();
  });

  test('makes no call when there is nothing to resolve', async () => {
    const connection = connectionWith({});
    await resolveToken2022Metadata(connection, []);
    expect(connection.getMultipleParsedAccounts).not.toHaveBeenCalled();
  });
});
