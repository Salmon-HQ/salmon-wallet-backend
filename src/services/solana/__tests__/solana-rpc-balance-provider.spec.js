'use strict';

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return { ...actual, Connection: jest.fn() };
});

const { Connection } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const provider = require('../solana-rpc-balance-provider');

const OWNER = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const T22 = 'HZ1JovNiVvGrGNiiYvEozEVjZ58xaU3RKwX8eACQBCt3';
const locals = { network: { config: { nodeUrl: 'https://rpc.example' } } };

const tokenAccount = (mint, amount, decimals) => ({
  account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
});

describe('solana-rpc-balance-provider', () => {
  let connection;

  beforeEach(() => {
    connection = {
      getBalance: jest.fn().mockResolvedValue(1500000000),
      getParsedTokenAccountsByOwner: jest.fn(async (_owner, { programId }) => ({
        value: programId.equals(TOKEN_2022_PROGRAM_ID)
          ? [tokenAccount(T22, '7', 0)]
          : [tokenAccount(USDC, '5000000', 6), tokenAccount(USDC, '1000000', 6)],
      })),
    };
    Connection.mockImplementation(() => connection);
  });

  it('connects to the network nodeUrl', async () => {
    await provider.getBalance(OWNER, undefined, locals);
    expect(Connection).toHaveBeenCalledWith('https://rpc.example', 'confirmed');
  });

  it('returns native SOL in Blockdaemon shape', async () => {
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

  it('aggregates classic token accounts per mint and includes Token-2022', async () => {
    const items = await provider.getBalance(OWNER, undefined, locals);
    const tokens = items.filter((i) => i.currency.type === 'token');

    expect(connection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
    expect(connection.getParsedTokenAccountsByOwner.mock.calls.map((c) => c[1].programId)).toEqual(
      expect.arrayContaining([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])
    );
    expect(tokens).toEqual([
      {
        owner: OWNER,
        blockchain: 'solana',
        confirmed_balance: '6000000',
        currency: {
          symbol: null,
          name: null,
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
          symbol: null,
          name: null,
          decimals: 0,
          type: 'token',
          asset_path: `solana/mint/${T22}`,
          detail: { contract: T22 },
        },
      },
    ]);
  });

  it('propagates RPC failures instead of returning a partial list', async () => {
    connection.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('rpc down'));
    await expect(provider.getBalance(OWNER, undefined, locals)).rejects.toThrow('rpc down');
  });
});
