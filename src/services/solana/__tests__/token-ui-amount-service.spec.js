'use strict';

jest.mock('../../../infrastructure/cache/cache-helper', () => ({
  getCacheKeyFor: (entity, property, value) => `${entity}:${property}:${value}`,
  getManyFromCache: jest.fn(async (keys) => new Map(keys.map((key) => [key, null]))),
  storeManyInCache: jest.fn(async () => {}),
}));

jest.mock('../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((_name, fn) => fn({ timeout: 10000, signal: undefined })),
}));

jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const cacheHelper = require('../../../infrastructure/cache/cache-helper');
const service = require('../token-ui-amount-service');

/**
 * Apple xStock (AAPLx) as mainnet served it on 2026-09-18 — a real Scaled UI
 * Amount mint whose scheduled multiplier had already taken effect. The expected
 * figure is the `uiAmount` the RPC itself reported for this exact account, so
 * the test pins our arithmetic to the token program's, not to our own reading
 * of the spec.
 */
const AAPLX = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp';
const AAPLX_RAW_AMOUNT = '677400755573';
const AAPLX_DECIMALS = 8;
const AAPLX_RPC_UI_AMOUNT = '6796.15187137';
const AAPLX_EFFECTIVE_AT = 1786149000;

const scaledUiExtension = (overrides = {}) => ({
  extension: 'scaledUiAmountConfig',
  state: {
    authority: 'S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS',
    multiplier: '1.0026642075893797',
    newMultiplier: '1.0032690125398187',
    newMultiplierEffectiveTimestamp: AAPLX_EFFECTIVE_AT,
    ...overrides,
  },
});

const mintAccount = (extensions) => ({
  data: { parsed: { info: extensions ? { extensions } : {} } },
});

const mockMintResponse = (accounts) => {
  axios.post.mockResolvedValue({ data: { result: { value: accounts } } });
};

beforeEach(() => {
  jest.clearAllMocks();
  cacheHelper.getManyFromCache.mockImplementation(
    async (keys) => new Map(keys.map((key) => [key, null]))
  );
});

describe('renderUiAmount', () => {
  it('scales a real AAPLx balance to the figure the RPC reports', () => {
    const multiplier = service.toFixedPoint('1.0032690125398187');
    expect(service.renderUiAmount(AAPLX_RAW_AMOUNT, AAPLX_DECIMALS, multiplier)).toBe(
      AAPLX_RPC_UI_AMOUNT
    );
  });

  it('keeps full precision on a balance beyond the safe-integer range', () => {
    // 2^53 base units would round under float arithmetic before scaling.
    const multiplier = service.toFixedPoint('2');
    expect(service.renderUiAmount('9007199254740993', 0, multiplier)).toBe('18014398509481986');
  });

  it('truncates rather than rounds, per the integration guide', () => {
    const multiplier = service.toFixedPoint('1.5');
    expect(service.renderUiAmount('1123456789', 6, multiplier)).toBe('1685.185183');
  });

  it('renders a whole number when the scaled fraction is empty', () => {
    expect(service.renderUiAmount('2000000', 6, service.toFixedPoint('1.5'))).toBe('3');
  });

  it('refuses a missing or non-positive multiplier', () => {
    expect(service.renderUiAmount('1', 6, null)).toBeNull();
    expect(service.renderUiAmount('1', 6, 0n)).toBeNull();
    expect(service.renderUiAmount('not-a-number', 6, service.SCALE)).toBeNull();
  });
});

describe('readMultiplier — scaled UI amount', () => {
  it('uses the current multiplier before the scheduled one takes effect', () => {
    const multiplier = service.readMultiplier(
      mintAccount([scaledUiExtension()]),
      AAPLX_EFFECTIVE_AT - 1
    );
    expect(multiplier).toBe(service.toFixedPoint('1.0026642075893797'));
  });

  it('switches to the new multiplier at its effective timestamp', () => {
    const multiplier = service.readMultiplier(
      mintAccount([scaledUiExtension()]),
      AAPLX_EFFECTIVE_AT
    );
    expect(multiplier).toBe(service.toFixedPoint('1.0032690125398187'));
  });

  it('ignores an unscheduled new multiplier (zero timestamp)', () => {
    const multiplier = service.readMultiplier(
      mintAccount([scaledUiExtension({ newMultiplierEffectiveTimestamp: 0 })]),
      AAPLX_EFFECTIVE_AT
    );
    expect(multiplier).toBe(service.toFixedPoint('1.0026642075893797'));
  });

  it('returns null for a mint carrying neither extension', () => {
    expect(service.readMultiplier(mintAccount([{ extension: 'transferHook' }]), 0)).toBeNull();
    expect(service.readMultiplier(mintAccount(null), 0)).toBeNull();
  });
});

describe('readMultiplier — interest bearing', () => {
  /**
   * Mirrors `amount_to_ui_amount` in the Token Extension Program: interest
   * under the historical average rate up to `lastUpdateTimestamp`, then under
   * `currentRate` since. Rates are basis points over a 365.24-day year.
   */
  const SECONDS_PER_YEAR = 60 * 60 * 24 * 365.24;
  const interestExtension = (state) => [{ extension: 'interestBearingConfig', state }];

  it('compounds a single rate continuously', () => {
    const initializedAt = 1_700_000_000;
    const elapsed = Math.round(SECONDS_PER_YEAR);
    const multiplier = service.readMultiplier(
      mintAccount(
        interestExtension({
          initializationTimestamp: initializedAt,
          lastUpdateTimestamp: initializedAt,
          preUpdateAverageRate: 0,
          currentRate: 500, // 5 % annual
        })
      ),
      initializedAt + elapsed
    );
    const expected = Math.exp((500 * elapsed) / SECONDS_PER_YEAR / 10000);
    expect(multiplier).toBe(service.toFixedPoint(expected));
  });

  it('applies the historical average rate to the pre-update span', () => {
    const initializedAt = 1_700_000_000;
    const lastUpdatedAt = initializedAt + Math.round(SECONDS_PER_YEAR);
    const now = lastUpdatedAt + Math.round(SECONDS_PER_YEAR);
    const multiplier = service.readMultiplier(
      mintAccount(
        interestExtension({
          initializationTimestamp: initializedAt,
          lastUpdateTimestamp: lastUpdatedAt,
          preUpdateAverageRate: 200,
          currentRate: 800,
        })
      ),
      now
    );
    const expected =
      Math.exp((200 * (lastUpdatedAt - initializedAt)) / SECONDS_PER_YEAR / 10000) *
      Math.exp((800 * (now - lastUpdatedAt)) / SECONDS_PER_YEAR / 10000);
    expect(multiplier).toBe(service.toFixedPoint(expected));
  });

  it('is neutral at a zero rate', () => {
    const multiplier = service.readMultiplier(
      mintAccount(
        interestExtension({
          initializationTimestamp: 1_700_000_000,
          lastUpdateTimestamp: 1_700_000_000,
          preUpdateAverageRate: 0,
          currentRate: 0,
        })
      ),
      1_800_000_000
    );
    expect(multiplier).toBe(service.SCALE);
  });
});

describe('getUiAmounts', () => {
  const locals = { network: { environment: 'mainnet' } };

  it('returns the scaled amount for a mint that rebases', async () => {
    mockMintResponse([mintAccount([scaledUiExtension()])]);
    const uiAmounts = await service.getUiAmounts(
      [{ mint: AAPLX, amount: AAPLX_RAW_AMOUNT, decimals: AAPLX_DECIMALS }],
      locals
    );
    expect(uiAmounts.get(AAPLX)).toBe(AAPLX_RPC_UI_AMOUNT);
  });

  it('omits a mint whose multiplier is exactly one', async () => {
    mockMintResponse([
      mintAccount([
        scaledUiExtension({
          multiplier: '1',
          newMultiplier: '1',
          newMultiplierEffectiveTimestamp: 0,
        }),
      ]),
    ]);
    const uiAmounts = await service.getUiAmounts(
      [{ mint: AAPLX, amount: AAPLX_RAW_AMOUNT, decimals: AAPLX_DECIMALS }],
      locals
    );
    expect(uiAmounts.size).toBe(0);
  });

  it('omits a mint with no scaling extension', async () => {
    mockMintResponse([mintAccount([{ extension: 'transferFeeConfig' }])]);
    const uiAmounts = await service.getUiAmounts(
      [{ mint: AAPLX, amount: '1000', decimals: 6 }],
      locals
    );
    expect(uiAmounts.size).toBe(0);
  });

  it('makes no request when there is nothing to resolve', async () => {
    await service.getUiAmounts([], locals);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('serves a cached config without calling the RPC again', async () => {
    cacheHelper.getManyFromCache.mockImplementation(
      async (keys) => new Map(keys.map((key) => [key, { extensions: [scaledUiExtension()] }]))
    );
    const uiAmounts = await service.getUiAmounts(
      [{ mint: AAPLX, amount: AAPLX_RAW_AMOUNT, decimals: AAPLX_DECIMALS }],
      locals
    );
    expect(axios.post).not.toHaveBeenCalled();
    expect(uiAmounts.get(AAPLX)).toBe(AAPLX_RPC_UI_AMOUNT);
  });

  it('caches plain mints too, so they are asked for once', async () => {
    mockMintResponse([mintAccount(null)]);
    await service.getUiAmounts([{ mint: AAPLX, amount: '1000', decimals: 6 }], locals);
    expect(cacheHelper.storeManyInCache).toHaveBeenCalledWith(
      [[expect.stringContaining(AAPLX), { extensions: null }]],
      expect.any(Number)
    );
  });

  it('surfaces an RPC error rather than inventing a multiplier', async () => {
    axios.post.mockResolvedValue({ data: { error: { message: 'node down' } } });
    await expect(
      service.getUiAmounts([{ mint: AAPLX, amount: '1000', decimals: 6 }], locals)
    ).rejects.toThrow('node down');
  });

  it('batches mints beyond the getMultipleAccounts cap', async () => {
    const mints = Array.from({ length: service.MAX_MINTS_PER_BATCH + 1 }, (_, i) => `mint-${i}`);
    axios.post.mockResolvedValue({ data: { result: { value: [] } } });
    await service.getUiAmounts(
      mints.map((mint) => ({ mint, amount: '1', decimals: 0 })),
      locals
    );
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
