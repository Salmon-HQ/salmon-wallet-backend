'use strict';

const { resolveEnricher } = require('../index');
const solanaPriceEnricher = require('../solana-price-enricher');
const bitcoinPriceEnricher = require('../bitcoin-price-enricher');
const nullPriceEnricher = require('../null-price-enricher');

describe('price-enrichers/index', () => {
  it('returns the Solana enricher for solana', () => {
    expect(resolveEnricher('solana')).toBe(solanaPriceEnricher);
  });

  it('returns the Bitcoin enricher for bitcoin', () => {
    expect(resolveEnricher('bitcoin')).toBe(bitcoinPriceEnricher);
  });

  it('falls back to the null enricher for unknown chains', () => {
    expect(resolveEnricher('ethereum')).toBe(nullPriceEnricher);
    expect(resolveEnricher(undefined)).toBe(nullPriceEnricher);
  });

  it('null enricher is a passthrough', async () => {
    const items = [{ owner: 'a' }, { owner: 'b' }];
    const result = await nullPriceEnricher.enrich(items);
    expect(result).toBe(items);
  });
});
