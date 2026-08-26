'use strict';

const mockProviderBitcoin = { getBalance: jest.fn() };
const mockProviderSolana = { getBalance: jest.fn() };
const mockProviderDefault = { getBalance: jest.fn() };

const mockEnricherBitcoin = { enrich: jest.fn() };
const mockEnricherSolana = { enrich: jest.fn() };
const mockEnricherNoOp = { enrich: jest.fn((items) => items) };

jest.mock('../balance-providers', () => ({
  resolveProvider: jest.fn((blockchain) => {
    if (blockchain === 'bitcoin') return mockProviderBitcoin;
    if (blockchain === 'solana') return mockProviderSolana;
    return mockProviderDefault;
  }),
}));

jest.mock('../price-enrichers', () => ({
  resolveEnricher: jest.fn((blockchain) => {
    if (blockchain === 'bitcoin') return mockEnricherBitcoin;
    if (blockchain === 'solana') return mockEnricherSolana;
    return mockEnricherNoOp;
  }),
}));

const balanceProviders = require('../balance-providers');
const priceEnrichers = require('../price-enrichers');
const service = require('../account-service');

describe('multichain account-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnricherNoOp.enrich.mockImplementation((items) => items);
  });

  it('dispatches getBalance to the resolved per-chain provider and runs the enricher', async () => {
    const fetched = [{ owner: 'btc-address', blockchain: 'bitcoin' }];
    const enriched = [{ ...fetched[0], _price: 50000 }];
    mockProviderBitcoin.getBalance.mockResolvedValue(fetched);
    mockEnricherBitcoin.enrich.mockResolvedValue(enriched);

    const locals = {
      network: { id: 'bitcoin-mainnet', blockchain: 'bitcoin', environment: 'mainnet' },
    };
    const result = await service.getBalance('btc-address', 'tokens-flag', locals);

    expect(balanceProviders.resolveProvider).toHaveBeenCalledWith('bitcoin');
    expect(mockProviderBitcoin.getBalance).toHaveBeenCalledWith(
      'btc-address',
      'tokens-flag',
      expect.objectContaining({ network: expect.objectContaining({ blockchain: 'bitcoin' }) })
    );
    expect(priceEnrichers.resolveEnricher).toHaveBeenCalledWith('bitcoin');
    expect(mockEnricherBitcoin.enrich).toHaveBeenCalledWith(fetched, locals);
    expect(mockProviderSolana.getBalance).not.toHaveBeenCalled();
    expect(mockProviderDefault.getBalance).not.toHaveBeenCalled();
    expect(result).toBe(enriched);
  });

  it('dispatches Solana balance requests to the Solana provider + enricher', async () => {
    mockProviderSolana.getBalance.mockResolvedValue([]);
    mockEnricherSolana.enrich.mockResolvedValue([]);

    await service.getBalance('sol-address', undefined, {
      network: { id: 'solana-mainnet', blockchain: 'solana', environment: 'mainnet' },
    });

    expect(balanceProviders.resolveProvider).toHaveBeenCalledWith('solana');
    expect(mockProviderSolana.getBalance).toHaveBeenCalled();
    expect(priceEnrichers.resolveEnricher).toHaveBeenCalledWith('solana');
    expect(mockEnricherSolana.enrich).toHaveBeenCalled();
    expect(mockProviderBitcoin.getBalance).not.toHaveBeenCalled();
    expect(mockEnricherBitcoin.enrich).not.toHaveBeenCalled();
  });

  it('falls back to the default provider + no-op enricher when the chain has no override', async () => {
    mockProviderDefault.getBalance.mockResolvedValue([
      { owner: 'eth-address', blockchain: 'ethereum' },
    ]);

    const result = await service.getBalance('eth-address', undefined, {
      network: { id: 'ethereum-mainnet', blockchain: 'ethereum', environment: 'mainnet' },
    });

    expect(balanceProviders.resolveProvider).toHaveBeenCalledWith('ethereum');
    expect(priceEnrichers.resolveEnricher).toHaveBeenCalledWith('ethereum');
    expect(mockProviderDefault.getBalance).toHaveBeenCalled();
    expect(mockEnricherNoOp.enrich).toHaveBeenCalled();
    expect(result).toEqual([{ owner: 'eth-address', blockchain: 'ethereum' }]);
  });
});
