'use strict';

const resource = require('../solana-transaction-resource');

// The resource is a pure mapper: lookup data (tokens, NFT metadata) is
// preloaded on `locals` by the service-layer `solana-rpc-enrichment` loader —
// covered by its own spec. The legs are the wallet's net change per asset
// off the parsed result's pre/post balances (spec 016).
describe('solana-transaction-resource rpc fallback parser', () => {
  const address = 'owner-address';
  const other = 'other-address';
  const USDC = {
    address: 'mint-usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: 'https://cdn.example/usdc.png',
  };

  const context = (tokens = [USDC], rpcNftBySignature = {}) => ({
    locals: { network: { id: 'solana-mainnet' }, tokens, rpcNftBySignature },
  });

  const keys = (...pubkeys) => pubkeys.map((pubkey) => ({ pubkey, signer: false }));

  const tx = ({ signature, accountKeys, meta, instructions = [] }) => ({
    address,
    signature,
    blockTime: 1710000000,
    meta: { err: null, fee: 5000, logMessages: [], ...meta },
    transaction: { message: { accountKeys, instructions } },
  });

  it('a native receive: SOL gained at the wallet index, from the instruction source', async () => {
    const result = await resource(
      tx({
        signature: 'sig-receive',
        accountKeys: keys(other, address),
        meta: {
          preBalances: [10_000_000_000, 1_000_000],
          postBalances: [8_749_995_000, 1_251_000_000],
        },
        instructions: [
          {
            parsed: {
              type: 'transfer',
              info: { source: other, destination: address, lamports: 1_250_000_000 },
            },
          },
        ],
      }),
      {},
      'target',
      context()
    );

    expect(result).toMatchObject({
      id: 'sig-receive',
      status: 'completed',
      type: 'receive',
      outputs: [],
    });
    expect(result.fee).toBeUndefined();
    expect(result.inputs).toEqual([
      expect.objectContaining({ amount: '1250000000', decimals: 9, symbol: 'SOL', source: other }),
    ]);
  });

  // Whoever composes the transaction that credits the wallet also chooses its
  // instruction order, so a counterparty read by position is a counterparty
  // they choose. A leg may only name the party that moved that leg's asset.
  it('names no source when the first instruction moved a different asset', async () => {
    const result = await resource(
      tx({
        signature: 'sig-decoy',
        accountKeys: keys(other, address),
        meta: {
          preBalances: [10_000_000_000, 1_000_000],
          postBalances: [8_749_995_000, 1_251_000_000],
        },
        instructions: [
          {
            parsed: {
              type: 'transferChecked',
              info: { authority: 'decoy-address', mint: 'mint-usdc', destination: 'ta-1' },
            },
          },
        ],
      }),
      {},
      'target',
      context()
    );

    expect(result.type).toBe('receive');
    expect(result.inputs[0].source).toBeUndefined();
  });

  // logMessages is free text any invoked program can write, so a type read
  // out of it by substring is a type the transaction's author picks.
  it('ignores a Bubblegum program id printed in a log message', async () => {
    const result = await resource(
      tx({
        signature: 'sig-log-mint',
        accountKeys: keys(other, address),
        meta: {
          preBalances: [10_000_000_000, 1_000_000],
          postBalances: [8_749_995_000, 1_251_000_000],
          logMessages: [`Program log: memo BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY`],
        },
        instructions: [
          {
            programId: '11111111111111111111111111111111',
            parsed: { type: 'transfer', info: { source: other, destination: address } },
          },
        ],
      }),
      {},
      'target',
      context()
    );

    expect(result.type).toBe('receive');
  });

  it('calls a fee-only transaction that invoked Bubblegum a mint', async () => {
    const result = await resource(
      tx({
        signature: 'sig-cnft-mint',
        accountKeys: keys(address, other),
        meta: { preBalances: [1_000_000_000, 0], postBalances: [999_995_000, 0] },
        instructions: [{ programId: 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY' }],
      }),
      {},
      'target',
      context()
    );

    expect(result.type).toBe('mint');
  });

  it('a token send: the mint the wallet lost, from the token list, with the fee on the payer', async () => {
    const result = await resource(
      tx({
        signature: 'sig-send',
        // SPL instructions name token accounts, so the wallet and the
        // counterparty are reached through the balance records' `owner`.
        accountKeys: keys(address, other, 'ta-1', 'ta-2'),
        meta: {
          preBalances: [1_000_000_000, 0, 0, 0],
          postBalances: [999_995_000, 0, 0, 0],
          preTokenBalances: [
            {
              accountIndex: 2,
              owner: address,
              mint: 'mint-usdc',
              uiTokenAmount: { amount: '2500000', decimals: 6 },
            },
          ],
          postTokenBalances: [
            {
              accountIndex: 2,
              owner: address,
              mint: 'mint-usdc',
              uiTokenAmount: { amount: '0', decimals: 6 },
            },
            {
              accountIndex: 3,
              owner: other,
              mint: 'mint-usdc',
              uiTokenAmount: { amount: '2500000', decimals: 6 },
            },
          ],
        },
        instructions: [
          {
            parsed: {
              type: 'transferChecked',
              info: { source: 'ta-1', destination: 'ta-2', mint: 'mint-usdc' },
            },
          },
        ],
      }),
      {},
      'target',
      context()
    );

    expect(result.type).toBe('send');
    expect(result.fee).toEqual({ amount: 5000, decimals: 9, symbol: 'SOL' });
    expect(result.inputs).toEqual([]);
    expect(result.outputs).toEqual([
      {
        amount: '2500000',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
        logo: 'https://cdn.example/usdc.png',
        contract: 'mint-usdc',
        destination: other,
      },
    ]);
  });

  it('a swap: one side lost, one gained — an interaction with both legs, SOL only above the side-leg floor', async () => {
    const result = await resource(
      tx({
        signature: 'sig-swap',
        accountKeys: keys(address, other),
        meta: {
          // 0.5 SOL out plus fee and 0.002 SOL of rent dust back: the dust is under the floor.
          preBalances: [2_000_000_000, 0],
          postBalances: [1_499_995_000, 0],
          preTokenBalances: [
            { owner: address, mint: 'mint-usdc', uiTokenAmount: { amount: '0', decimals: 6 } },
          ],
          postTokenBalances: [
            {
              owner: address,
              mint: 'mint-usdc',
              uiTokenAmount: { amount: '75000000', decimals: 6 },
            },
          ],
        },
      }),
      {},
      'target',
      context()
    );

    expect(result.type).toBe('interaction');
    expect(result.inputs).toEqual([
      expect.objectContaining({ contract: 'mint-usdc', amount: '75000000' }),
    ]);
    expect(result.outputs).toEqual([
      expect.objectContaining({ symbol: 'SOL', amount: '500000000' }),
    ]);
    expect(result.inputs[0].source).toBeUndefined();
  });

  it('a mint the token list does not know still gets a leg, named by its mint', async () => {
    const result = await resource(
      tx({
        signature: 'sig-unknown-mint',
        accountKeys: keys(other, address),
        meta: {
          preBalances: [0, 0],
          postBalances: [0, 0],
          preTokenBalances: [],
          postTokenBalances: [
            {
              owner: address,
              mint: 'Mint111111111111111111111111111111111111111',
              uiTokenAmount: { amount: '7', decimals: 2 },
            },
          ],
        },
      }),
      {},
      'target',
      context([])
    );

    expect(result.type).toBe('receive');
    expect(result.inputs[0]).toMatchObject({
      amount: '7',
      decimals: 2,
      symbol: 'Mint…1111',
      contract: 'Mint111111111111111111111111111111111111111',
    });
  });

  it('nothing moved: an interaction when the wallet paid the fee, unknown otherwise', async () => {
    const paid = await resource(
      tx({
        signature: 'sig-fee',
        accountKeys: keys(address),
        meta: { preBalances: [1_000_000], postBalances: [995_000] },
      }),
      {},
      'target',
      context()
    );
    expect(paid).toMatchObject({ type: 'interaction', inputs: [], outputs: [] });

    const bystander = await resource(
      tx({
        signature: 'sig-none',
        accountKeys: keys(other, address),
        meta: { preBalances: [1, 5], postBalances: [1, 5] },
      }),
      {},
      'target',
      context()
    );
    expect(bystander.type).toBe('unknown');
  });

  it('an NFT the enrichment preloaded is an NFT leg: amount 1, collection name, image', async () => {
    const nft = {
      symbol: 'APE',
      mint: { address: { toBase58: () => 'mint-nft' } },
      json: { collection: { name: 'Apes' }, image: 'ipfs://QmImage' },
    };
    const result = await resource(
      tx({
        signature: 'sig-nft',
        accountKeys: keys(other, address),
        meta: {
          preBalances: [0, 0],
          postBalances: [0, 0],
          preTokenBalances: [],
          postTokenBalances: [
            { owner: address, mint: 'mint-nft', uiTokenAmount: { amount: '1', decimals: 0 } },
          ],
        },
      }),
      {},
      'target',
      context([], { 'sig-nft': nft })
    );

    expect(result.type).toBe('receive');
    expect(result.inputs[0]).toMatchObject({
      amount: 1,
      decimals: 0,
      symbol: 'APE',
      name: 'Apes',
      contract: 'mint-nft',
    });
    expect(result.inputs[0].logo).toContain('QmImage');
  });

  it('passes an enriched transaction through, minus its `_source` tag', async () => {
    const result = await resource(
      { _source: 'enriched', id: 'x', type: 'send' },
      {},
      'target',
      context()
    );
    expect(result).toEqual({ id: 'x', type: 'send' });
  });
});
