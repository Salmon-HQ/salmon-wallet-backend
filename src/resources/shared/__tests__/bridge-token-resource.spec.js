'use strict';

const decorate = require('../bridge-token-resource');

// Shape as v4 actually returns it, including `legacy_symbol` — the v2 ticker
// that stays our public vocabulary.
const USDC_SOL = {
  symbol: 'usdc',
  network: 'sol',
  legacy_symbol: 'usdcsol',
  name: 'USD Coin',
  icon_url: 'https://images.stealthex.io/usdc.svg',
  extra_id: null,
  address_regex: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  extra_id_regex: null,
  warnings: { deposit: [], withdrawal: ['slow'] },
};

const SOL_NATIVE = {
  symbol: 'sol',
  network: 'mainnet',
  legacy_symbol: 'sol',
  name: 'Solana',
  icon_url: 'https://images.stealthex.io/sol.svg',
  extra_id: null,
  address_regex: null,
  extra_id_regex: null,
  warnings: { deposit: [], withdrawal: [] },
};

describe('bridge-token-resource', () => {
  it('maps a v4 currency onto the shipped public shape', async () => {
    await expect(decorate(USDC_SOL)).resolves.toEqual({
      symbol: 'usdcsol',
      name: 'USD Coin',
      network: 'sol',
      chain: 'solana',
      has_extra_id: false,
      extra_id: null,
      warnings_from: [],
      warnings_to: ['slow'],
      validation_address: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
      validation_extra: null,
      // v4 has no per-currency explorer URLs. The keys stay because dropping
      // one is a wire change; nothing in the wallet reads them.
      address_explorer: null,
      tx_explorer: null,
      logo: 'https://images.stealthex.io/usdc.svg',
    });
  });

  it('emits the legacy ticker, never the v4 symbol', async () => {
    // v4 `symbol` is not unique: several currencies are called `usdc`. The
    // wallet keys token identity off this string.
    const resource = await decorate(USDC_SOL);

    expect(resource.symbol).toBe('usdcsol');
  });

  it('reports null network for a native, as v2 did', async () => {
    // The wallet builds `token.network ?? '<chain>-mainnet'`; leaking v4's
    // literal "mainnet" makes the network id the string "mainnet".
    const resource = await decorate(SOL_NATIVE);

    expect(resource.network).toBeNull();
    expect(resource.chain).toBe('solana');
  });

  it('derives has_extra_id from the memo field', async () => {
    const withMemo = await decorate({ ...USDC_SOL, extra_id: 'Memo' });

    expect(withMemo.has_extra_id).toBe(true);
    expect(withMemo.extra_id).toBe('Memo');
  });

  it('defaults warnings to empty arrays when upstream omits them', async () => {
    const resource = await decorate({ ...USDC_SOL, warnings: undefined });

    expect(resource.warnings_from).toEqual([]);
    expect(resource.warnings_to).toEqual([]);
  });
});
