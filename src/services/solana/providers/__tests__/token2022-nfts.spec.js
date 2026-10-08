'use strict';

/**
 * The Seeker Genesis Token as the listing and the detail read it: DAS reports
 * it as a `V1_NFT` with empty content, and its Token-2022 mint keeps the
 * metadata on its group. Shapes recorded from mainnet.
 */

jest.mock('axios');
jest.mock('../../parser/triton-rpc');
jest.mock('../../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_name, run) => run({ timeout: 10000, signal: undefined })),
}));
jest.mock('../../budgeted-connection', () => ({ createBudgetedConnection: jest.fn() }));

const axios = require('axios');
const { createBudgetedConnection } = require('../../budgeted-connection');
const tritonProvider = require('../triton-provider');

const OWNER = 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ';
const SGT_MINT = '5vPkA3YXK6ByvioKaEyQofqT4QXVWMCXqpvYshswXkCb';
const SGT_GROUP = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SGT_URI = 'https://r2.solanamobiledappstore.com/skr/sgt-metadata.json';
const locals = { network: { environment: 'mainnet' } };

const emptyDasSgt = {
  id: SGT_MINT,
  interface: 'V1_NFT',
  content: { json_uri: '', files: [], metadata: {}, links: {} },
  grouping: [],
  ownership: { owner: OWNER },
  token_info: { supply: 1, decimals: 0, token_program: TOKEN_2022, balance: 1 },
};
const otherDasNft = {
  id: 'Other1111111111111111111111111111111111111',
  interface: 'V1_NFT',
  content: { json_uri: 'https://x/o.json', metadata: { name: 'Other' }, links: {} },
  grouping: [],
  token_info: { supply: 1, decimals: 0, balance: 1 },
};

const parsed = (extensions) => ({ data: { parsed: { info: { decimals: 0, extensions } } } });
const accounts = {
  [SGT_MINT]: parsed([
    { extension: 'metadataPointer', state: { metadataAddress: SGT_GROUP } },
    { extension: 'tokenGroupMember', state: { group: SGT_GROUP, mint: SGT_MINT } },
  ]),
  [SGT_GROUP]: parsed([
    {
      extension: 'tokenMetadata',
      state: { name: 'Seeker Genesis Token', symbol: 'SeekerGT', uri: SGT_URI },
    },
  ]),
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRITON_RPC_URL = 'https://triton.example/token';
  createBudgetedConnection.mockReturnValue({
    getParsedTokenAccountsByOwner: jest.fn().mockResolvedValue({
      value: [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: SGT_MINT,
                  state: 'frozen',
                  extensions: [{ extension: 'immutableOwner' }],
                  tokenAmount: { decimals: 0, amount: '1', uiAmount: 1 },
                },
              },
            },
          },
        },
      ],
    }),
    getMultipleParsedAccounts: jest.fn(async (keys) => ({
      value: keys.map((k) => accounts[k.toBase58()] ?? null),
    })),
  });
});

describe('Token-2022 NFTs in the owner listing', () => {
  beforeEach(() => {
    axios.post.mockResolvedValue({ data: { result: { items: [emptyDasSgt, otherDasNft] } } });
  });

  it("names the Seeker Genesis Token from its group's metadata, and says it is frozen", async () => {
    const { data } = await tritonProvider.getNftsByOwner(OWNER, {}, locals);

    const sgt = data.filter((n) => n.mint.address === SGT_MINT);
    expect(sgt).toHaveLength(1);
    expect(sgt[0]).toMatchObject({
      name: 'Seeker Genesis Token',
      symbol: 'SeekerGT',
      uri: SGT_URI,
      frozen: true,
    });
  });

  it('keeps every other NFT as the indexer gave it', async () => {
    const { data } = await tritonProvider.getNftsByOwner(OWNER, {}, locals);

    expect(data.find((n) => n.mint.address === otherDasNft.id)).toMatchObject({ name: 'Other' });
  });
});

describe('a Token-2022 NFT looked up by mint', () => {
  it('carries the metadata its group holds', async () => {
    axios.post.mockResolvedValue({ data: { result: emptyDasSgt } });

    const nft = await tritonProvider.getNftByMint(SGT_MINT, locals);

    expect(nft).toMatchObject({ name: 'Seeker Genesis Token', uri: SGT_URI });
  });
});
