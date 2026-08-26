'use strict';

const loadService = () => {
  jest.resetModules();

  process.env.JUPITER_SWAP_URL = 'https://jupiter.test/ultra/v1';
  process.env.JUPITER_API_KEY = 'jupiter-key';
  process.env.JUPITER_SWAP_REFERRAL_FEE_BPS = '75';
  process.env.JUPITER_SWAP_REFERRAL_ACCOUNT = 'referral-account';

  const http = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const rateLimiter = {
    waitAndConsume: jest.fn().mockResolvedValue(undefined),
  };
  const withRetry = jest.fn(async (operation) => operation());
  const getByMints = jest.fn().mockResolvedValue([]);

  jest.doMock('axios', () => http);
  jest.doMock('../../../infrastructure/rate-limiting/jupiter-rate-limiter', () => ({
    rateLimiter,
    withRetry,
  }));
  jest.doMock('../solana-ft-service', () => ({ getByMints }));

  const service = require('../solana-ft-swap-service');

  return {
    service,
    http,
    rateLimiter,
    withRetry,
    getByMints,
  };
};

describe('solana-ft-swap-service unit', () => {
  afterEach(() => {
    jest.dontMock('axios');
    jest.dontMock('../../../infrastructure/rate-limiting/jupiter-rate-limiter');
    jest.dontMock('../solana-ft-service');
    delete process.env.JUPITER_SWAP_URL;
    delete process.env.JUPITER_API_KEY;
    delete process.env.JUPITER_SWAP_REFERRAL_FEE_BPS;
    delete process.env.JUPITER_SWAP_REFERRAL_ACCOUNT;
  });

  it('requests Jupiter orders with frontend-facing params, referral config, and api key', async () => {
    const { service, http, rateLimiter, withRetry } = loadService();
    http.get.mockResolvedValue({
      data: {
        transaction: 'unsigned-tx',
        requestId: 'request-1',
        router: 'iris',
      },
    });

    const result = await service.order({
      amount: '1000000',
      inputMint: 'mint-in',
      outputMint: 'mint-out',
      publicKey: 'wallet-1',
    });

    expect(rateLimiter.waitAndConsume).toHaveBeenCalledTimes(1);
    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxRetries: 3,
        operationName: 'Jupiter Ultra Order (mint-in → mint-out)',
      })
    );
    expect(http.get).toHaveBeenCalledWith('https://jupiter.test/ultra/v1/order', {
      timeout: 10000,
      headers: {
        'x-api-key': 'jupiter-key',
      },
      params: {
        inputMint: 'mint-in',
        outputMint: 'mint-out',
        amount: '1000000',
        taker: 'wallet-1',
        referralAccount: 'referral-account',
        referralFee: 75,
      },
    });
    expect(result).toEqual({
      transaction: 'unsigned-tx',
      requestId: 'request-1',
      router: 'iris',
    });
  });

  it('logs a greppable error when Jupiter applies less than the configured referral fee', async () => {
    const { service, http } = loadService();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    http.get.mockResolvedValue({
      data: {
        transaction: 'unsigned-tx',
        requestId: 'request-1',
        router: 'metis',
        // Ultra's default fee — what comes back when the referral token
        // account for `feeMint` does not exist and our 75 bps is dropped.
        feeBps: 2,
        feeMint: 'So11111111111111111111111111111111111111112',
      },
    });

    const result = await service.order({
      amount: '1000000',
      inputMint: 'mint-in',
      outputMint: 'mint-out',
      publicKey: 'wallet-1',
    });

    // Log-only: the order is still served to the client.
    expect(result).toMatchObject({ transaction: 'unsigned-tx' });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[JUPITER_REFERRAL_FEE_NOT_APPLIED]'),
      expect.objectContaining({
        expectedFeeBps: 75,
        appliedFeeBps: 2,
        feeMint: 'So11111111111111111111111111111111111111112',
      })
    );

    errorSpy.mockRestore();
  });

  it('stays quiet when Jupiter applies the full referral fee', async () => {
    const { service, http } = loadService();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    http.get.mockResolvedValue({
      data: { transaction: 'unsigned-tx', requestId: 'request-1', feeBps: 75 },
    });

    await service.order({
      amount: '1000000',
      inputMint: 'mint-in',
      outputMint: 'mint-out',
      publicKey: 'wallet-1',
    });

    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('returns null for Jupiter order validation errors', async () => {
    const { service, http } = loadService();
    http.get.mockRejectedValue({
      response: {
        status: 400,
        statusText: 'Bad Request',
        data: { error: 'no route' },
      },
    });

    const result = await service.order({
      amount: '1000000',
      inputMint: 'bad-mint',
      outputMint: 'mint-out',
      publicKey: 'wallet-1',
    });

    expect(result).toBeNull();
  });

  it('posts signed transactions to Jupiter execute and returns successful responses', async () => {
    const { service, http, withRetry } = loadService();
    http.post.mockResolvedValue({
      data: {
        status: 'Success',
        signature: 'sig-1',
        slot: 123,
      },
    });

    const result = await service.execute({
      signedTransaction: 'signed-tx',
      requestId: 'request-1',
    });

    expect(withRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxRetries: 2,
        operationName: 'Jupiter Ultra Execute (requestId: request-...)',
      })
    );
    expect(http.post).toHaveBeenCalledWith(
      'https://jupiter.test/ultra/v1/execute',
      {
        signedTransaction: 'signed-tx',
        requestId: 'request-1',
      },
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'jupiter-key',
        },
      }
    );
    expect(result).toEqual({
      status: 'Success',
      signature: 'sig-1',
      slot: 123,
    });
  });

  it('surfaces the provider reason when Jupiter execute reports Failed', async () => {
    const { service, http } = loadService();
    http.post.mockResolvedValue({
      data: {
        status: 'Failed',
        code: 6001,
        error: 'Slippage tolerance exceeded',
      },
    });

    // Still the 404 `execution_failed` the contract specifies, but carrying
    // the reason: the wallet classifies swap failures by matching this text,
    // and a generic message made slippage look like an infrastructure fault.
    await expect(
      service.execute({ signedTransaction: 'signed-tx', requestId: 'request-1' })
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'execution_failed',
      message: 'Slippage tolerance exceeded (code 6001)',
    });
  });

  it('treats a response without an explicit Success status as a failure', async () => {
    const { service, http } = loadService();
    // An expired order comes back in this shape; passing it through answered
    // 200 with an undefined status and signature.
    http.post.mockResolvedValue({
      data: { code: -1, error: 'Order not found, it might have expired' },
    });

    await expect(
      service.execute({ signedTransaction: 'signed-tx', requestId: 'request-1' })
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'execution_failed',
    });
  });

  it('passes a successful execution through', async () => {
    const { service, http } = loadService();
    http.post.mockResolvedValue({
      data: { status: 'Success', signature: 'sig-1', slot: 42 },
    });

    await expect(
      service.execute({ signedTransaction: 'signed-tx', requestId: 'request-1' })
    ).resolves.toMatchObject({ status: 'Success', signature: 'sig-1' });
  });

  describe('resolveOrderAmount', () => {
    it.each([['0'], ['-5'], ['1.5'], ['abc']])(
      'rejects the raw amount %s without asking Jupiter',
      async (amount) => {
        const { service, http } = loadService();

        await expect(
          service.resolveOrderAmount({ amount, inputMint: 'mint-in' }, {})
        ).resolves.toMatchObject({ error: 'invalid_parameter' });
        expect(http.get).not.toHaveBeenCalled();
      }
    );

    it('returns the raw amount unchanged when amount is provided', async () => {
      const { service, getByMints } = loadService();

      const result = await service.resolveOrderAmount(
        { amount: '1000000', uiAmount: undefined, inputMint: 'mint-in' },
        {}
      );

      expect(result).toEqual({ amount: '1000000' });
      expect(getByMints).not.toHaveBeenCalled();
    });

    it('errors when neither amount nor uiAmount is provided', async () => {
      const { service } = loadService();

      const result = await service.resolveOrderAmount(
        { amount: undefined, uiAmount: undefined, inputMint: 'mint-in' },
        {}
      );

      expect(result).toEqual({
        error: 'missing_parameter',
        error_description: 'Either `amount` (raw) or `uiAmount` (human-readable) is required',
      });
    });

    it('resolves uiAmount via the Jupiter v2 catalog using the input mint decimals', async () => {
      const { service, getByMints } = loadService();
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      getByMints.mockResolvedValue([{ id: usdcMint, decimals: 6 }]);

      const result = await service.resolveOrderAmount(
        { uiAmount: '1.5', inputMint: usdcMint },
        { network: { id: 'solana-mainnet' } }
      );

      expect(getByMints).toHaveBeenCalledWith([usdcMint], { network: { id: 'solana-mainnet' } });
      expect(result).toEqual({ amount: '1500000' });
    });

    it('short-circuits SOL_ADDRESS to 9 decimals without a catalog lookup', async () => {
      const { service, getByMints } = loadService();

      const result = await service.resolveOrderAmount(
        {
          uiAmount: '0.5',
          inputMint: 'So11111111111111111111111111111111111111112',
        },
        {}
      );

      expect(getByMints).not.toHaveBeenCalled();
      expect(result).toEqual({ amount: '500000000' });
    });

    it('errors when uiAmount is not a positive number', async () => {
      const { service } = loadService();

      const result = await service.resolveOrderAmount({ uiAmount: '-1', inputMint: 'mint-in' }, {});

      expect(result).toEqual({
        error: 'invalid_parameter',
        error_description: 'uiAmount must be a positive number',
      });
    });

    it('errors when the input mint is not present in the catalog', async () => {
      const { service, getByMints } = loadService();
      getByMints.mockResolvedValue([]);

      const result = await service.resolveOrderAmount(
        { uiAmount: '1', inputMint: 'unknown-mint' },
        {}
      );

      expect(result).toEqual({
        error: 'unknown_mint',
        error_description: 'Could not resolve decimals for inputMint=unknown-mint',
      });
    });
  });
});
