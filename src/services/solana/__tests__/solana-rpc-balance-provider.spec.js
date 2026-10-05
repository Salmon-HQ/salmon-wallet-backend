'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_name, run) => run({ timeout: 10000, signal: undefined })),
}));

const axios = require('axios');
const { providerCall } = require('../../../infrastructure/providers/provider-client');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const provider = require('../solana-rpc-balance-provider');

const OWNER = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const T22 = 'HZ1JovNiVvGrGNiiYvEozEVjZ58xaU3RKwX8eACQBCt3';
const locals = { network: { environment: 'mainnet', config: { nodeUrl: 'https://rpc.example' } } };

const tokenAccount = (mint, amount, decimals) => ({
  account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
});

// One JSON-RPC batch answer, matched to the request by id.
const answer = (byId) => (_url, body) =>
  Promise.resolve({ data: body.map(({ id }) => ({ jsonrpc: '2.0', id, ...byId[id] })) });

const healthy = {
  balance: { result: { context: { slot: 1 }, value: 1500000000 } },
  'token-program': {
    result: { value: [tokenAccount(USDC, '5000000', 6), tokenAccount(USDC, '1000000', 6)] },
  },
  'token-2022': { result: { value: [tokenAccount(T22, '7', 0)] } },
};

describe('solana-rpc-balance-provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockImplementation(answer(healthy));
  });

  it('asks the network node once, through the triton provider profile', async () => {
    await provider.getBalance(OWNER, undefined, locals);

    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(providerCall).toHaveBeenCalledWith('triton', expect.any(Function), {
      locals,
      operationName: 'Solana balance',
    });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://rpc.example');
    expect(body.map((b) => b.method)).toEqual([
      'getBalance',
      'getTokenAccountsByOwner',
      'getTokenAccountsByOwner',
    ]);
    expect(body.slice(1).map((b) => b.params[1].programId)).toEqual([
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
    ]);
    expect(body.every((b) => b.params.at(-1).commitment === 'confirmed')).toBe(true);
  });

  it('returns native SOL in the balance item shape', async () => {
    const [native] = await provider.getBalance(OWNER, undefined, locals);
    expect(native).toEqual({
      owner: OWNER,
      blockchain: 'solana',
      confirmed_balance: '1500000000',
      currency: {
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        type: 'native',
        asset_path: 'solana/native/sol',
      },
    });
  });

  it('aggregates token accounts per mint across both token programs', async () => {
    const items = await provider.getBalance(OWNER, undefined, locals);

    expect(items.filter((i) => i.currency.type === 'token')).toEqual([
      {
        owner: OWNER,
        blockchain: 'solana',
        confirmed_balance: '6000000',
        currency: {
          decimals: 6,
          type: 'token',
          asset_path: `solana/mint/${USDC}`,
          detail: { contract: USDC },
        },
      },
      {
        owner: OWNER,
        blockchain: 'solana',
        confirmed_balance: '7',
        currency: {
          decimals: 0,
          type: 'token',
          asset_path: `solana/mint/${T22}`,
          detail: { contract: T22 },
        },
      },
    ]);
  });

  it('fails the balance when the node answers any call with a JSON-RPC error', async () => {
    axios.post.mockImplementation(
      answer({
        ...healthy,
        'token-2022': { error: { code: -32005, message: 'Node is behind' } },
      })
    );

    await expect(provider.getBalance(OWNER, undefined, locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'upstream_unavailable',
    });
  });

  it('lets a transport failure through unchanged for the error handler', async () => {
    const down = Object.assign(new Error('timeout'), { code: 'ECONNABORTED', request: {} });
    axios.post.mockRejectedValue(down);

    await expect(provider.getBalance(OWNER, undefined, locals)).rejects.toBe(down);
  });
});
