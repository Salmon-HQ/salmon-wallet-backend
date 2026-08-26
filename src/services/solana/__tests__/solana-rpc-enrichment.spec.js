'use strict';

jest.mock('../solana-ft-service', () => ({
  list: jest.fn(),
}));

jest.mock('../solana-nft-service', () => ({
  find: jest.fn(),
}));

jest.mock('../solana-address-service', () => ({
  getAccountInfo: jest.fn(),
  getTokenAccounts: jest.fn(),
}));

const { list: listTokens } = require('../solana-ft-service');
const { find: findNft } = require('../solana-nft-service');
const { getTokenAccounts } = require('../solana-address-service');
const { loadRpcEnrichment } = require('../solana-rpc-enrichment');

describe('solana-rpc-enrichment loader', () => {
  const address = 'owner-address';

  const makeLocals = () => ({
    network: {
      id: 'solana-mainnet',
      environment: 'mainnet',
      config: { nodeUrl: 'https://rpc.example' },
    },
  });

  const rpcTx = (signature, meta = {}) => ({
    address,
    signature,
    meta,
    _source: 'rpc-standard',
  });

  const nftMeta = (mint, owner = address) => ({
    innerInstructions: [
      {
        instructions: [{ parsed: { info: { owner, mint } } }],
      },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listTokens.mockResolvedValue([]);
    getTokenAccounts.mockResolvedValue([]);
    findNft.mockResolvedValue(null);
  });

  it('loads the token list and token accounts once per page of rpc transactions', async () => {
    const locals = makeLocals();

    await loadRpcEnrichment([rpcTx('sig-1'), rpcTx('sig-2')], locals);

    expect(listTokens).toHaveBeenCalledTimes(1);
    expect(getTokenAccounts).toHaveBeenCalledTimes(1);
    expect(getTokenAccounts).toHaveBeenCalledWith(address, expect.any(Object));
    expect(locals.tokens).toEqual([]);
    expect(locals.tokenAccounts).toEqual([]);
  });

  it('does not reload lookups already memoized on locals', async () => {
    const locals = { ...makeLocals(), tokens: [{ address: 'mint-1' }], tokenAccounts: ['ta-1'] };

    await loadRpcEnrichment([rpcTx('sig-1')], locals);

    expect(listTokens).not.toHaveBeenCalled();
    expect(getTokenAccounts).not.toHaveBeenCalled();
  });

  it('is a no-op for enriched-only or empty pages', async () => {
    const locals = makeLocals();

    await loadRpcEnrichment([], locals);
    await loadRpcEnrichment([{ signature: 'sig-e', _source: 'enriched' }], locals);

    expect(listTokens).not.toHaveBeenCalled();
    expect(getTokenAccounts).not.toHaveBeenCalled();
    expect(findNft).not.toHaveBeenCalled();
    expect(locals.rpcNftBySignature).toBeUndefined();
  });

  it('resolves the NFT per transaction with an owner-matching mint candidate', async () => {
    const locals = makeLocals();
    const nft = { json: { collection: { name: 'Collection' } } };
    findNft.mockResolvedValue(nft);

    await loadRpcEnrichment(
      [
        rpcTx('sig-nft', nftMeta('mint-nft')),
        rpcTx('sig-plain'),
        rpcTx('sig-other-owner', nftMeta('mint-x', 'someone-else')),
      ],
      locals
    );

    expect(findNft).toHaveBeenCalledTimes(1);
    expect(findNft).toHaveBeenCalledWith('mint-nft', locals);
    expect(locals.rpcNftBySignature).toEqual({ 'sig-nft': nft });
  });

  it('keeps one findNft call per transaction even for repeated mints', async () => {
    const locals = makeLocals();

    await loadRpcEnrichment(
      [rpcTx('sig-1', nftMeta('mint-dup')), rpcTx('sig-2', nftMeta('mint-dup'))],
      locals
    );

    expect(findNft).toHaveBeenCalledTimes(2);
  });
});
