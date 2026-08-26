'use strict';

const resource = require('../solana-transaction-resource');

// The resource is a pure mapper: lookup data (tokens, token accounts, NFT
// metadata) is preloaded on `locals` by the service-layer
// `solana-rpc-enrichment` loader — covered by its own spec.
describe('solana-transaction-resource rpc fallback parser', () => {
  const address = 'owner-address';
  const baseContext = {
    locals: {
      network: {
        id: 'solana-mainnet',
        environment: 'mainnet',
        config: { nodeUrl: 'https://rpc.example' },
      },
    },
  };

  const cloneContext = () => ({
    locals: {
      network: { ...baseContext.locals.network },
      tokens: [],
      tokenAccounts: [],
    },
  });

  it('maps a native RECEIVE transaction using lamports fallback', async () => {
    const transactionInfo = {
      address,
      signature: 'sig-receive',
      blockTime: 1710000000,
      meta: {
        err: null,
        fee: 5000,
        logMessages: [],
        innerInstructions: [
          {
            instructions: [
              {
                parsed: {
                  info: {
                    lamports: 1250000000,
                  },
                },
              },
            ],
          },
        ],
      },
      transaction: {
        message: {
          accountKeys: [
            {
              signer: false,
              pubkey: { toBase58: () => 'other-signer' },
            },
          ],
          instructions: [
            {
              parsed: {
                type: 'transfer',
                info: {
                  source: 'sender-address',
                  destination: address,
                  lamports: 1250000000,
                },
              },
            },
          ],
        },
      },
    };

    const result = await resource(transactionInfo, {}, 'target', cloneContext());

    expect(result).toMatchObject({
      id: 'sig-receive',
      timestamp: 1710000000,
      status: 'completed',
      type: 'receive',
      outputs: [],
    });
    expect(result.fee).toBeUndefined();
    expect(result.inputs).toEqual([
      {
        amount: 1250000000,
        decimals: 9,
        symbol: 'SOL',
        name: 'Wrapped SOL',
        logo: expect.stringContaining('So11111111111111111111111111111111111111112'),
        contract: 'So11111111111111111111111111111111111111112',
        source: 'sender-address',
      },
    ]);
  });

  it('maps a token SEND transaction from preTokenBalances', async () => {
    const context = cloneContext();
    context.locals.tokens = [
      {
        address: 'mint-1',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logoURI: 'https://cdn.example/usdc.png',
      },
    ];
    context.locals.tokenAccounts = ['token-account-1'];

    const transactionInfo = {
      address,
      signature: 'sig-send',
      blockTime: 1710001111,
      meta: {
        err: null,
        logMessages: [],
        innerInstructions: [
          {
            instructions: [
              {
                parsed: {
                  info: {
                    destination: 'token-account-1',
                    mint: 'mint-1',
                  },
                },
              },
            ],
          },
        ],
        preTokenBalances: [
          {
            owner: address,
            uiTokenAmount: {
              amount: '2500000',
            },
          },
        ],
      },
      transaction: {
        message: {
          accountKeys: [],
          instructions: [
            {
              parsed: {
                type: 'transfer',
                info: {
                  source: address,
                  destination: 'destination-address',
                },
              },
            },
          ],
        },
      },
    };

    const result = await resource(transactionInfo, {}, 'target', context);

    expect(result).toMatchObject({
      id: 'sig-send',
      timestamp: 1710001111,
      status: 'completed',
      type: 'send',
      inputs: [],
      outputs: [
        {
          amount: '2500000',
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
          logo: 'https://cdn.example/usdc.png',
          contract: 'mint-1',
          destination: 'destination-address',
        },
      ],
    });
  });
});
