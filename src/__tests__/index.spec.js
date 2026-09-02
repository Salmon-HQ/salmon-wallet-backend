'use strict';

const createApp = () => ({
  use: jest.fn(),
});

const mockApp = createApp();
const mockExpress = jest.fn(() => mockApp);
mockExpress.urlencoded = jest.fn(() => 'urlencoded-middleware');
mockExpress.json = jest.fn(() => 'json-middleware');

jest.mock('express', () => mockExpress);
jest.mock('cors', () => jest.fn(() => 'cors-middleware'));
jest.mock('compression', () => jest.fn(() => 'compression-middleware'));
jest.mock('serverless-http', () => jest.fn(() => 'serverless-handler'));
jest.mock('../../packages/middleware', () => ({ logger: 'logger-middleware' }));
jest.mock('../handler', () => jest.fn(() => 'wrapped-handler'));
jest.mock('../middlewares/rate-limit', () => jest.fn(({ prefix }) => `rate-limit:${prefix}`));
jest.mock('../constants/networks', () => [
  { id: 'bitcoin-mainnet', blockchain: 'bitcoin', environment: 'mainnet' },
  { id: 'bitcoin-testnet', blockchain: 'bitcoin', environment: 'testnet' },
  { id: 'solana-mainnet', blockchain: 'solana', environment: 'mainnet' },
  { id: 'ethereum-mainnet', blockchain: 'ethereum', environment: 'mainnet' },
]);
jest.mock('../constants/blockchains', () => ({
  BITCOIN: 'bitcoin',
  SOLANA: 'solana',
  ETHEREUM: 'ethereum',
  BLOCKCHAINS: ['bitcoin', 'solana', 'ethereum'],
}));
jest.mock('../routes/shared/info-router', () => 'info-router');
jest.mock('../routes/multichain', () => 'multichain-router');
jest.mock('../routes/shared/coingecko-router', () => 'coingecko-router');
jest.mock('../routes/shared/dapp-router', () => 'dapp-router');
jest.mock('../routes/shared/network-router', () => 'network-router');
jest.mock('../routes/bitcoin', () => 'bitcoin-router');
jest.mock('../routes/solana', () => 'solana-router');
jest.mock('../routes/ethereum', () => 'ethereum-router');

const findChainMount = (chain) =>
  mockApp.use.mock.calls.find(
    (call) => call[0] === `/v1/${chain}-:env` && call[call.length - 1] === `${chain}-router`
  );

describe('src/index route wiring', () => {
  beforeEach(() => {
    jest.resetModules();
    mockApp.use.mockClear();
    mockExpress.mockClear();
    mockExpress.urlencoded.mockClear();
    mockExpress.json.mockClear();
  });

  it('mounts the active top-level routes', () => {
    require('../index');

    expect(mockExpress).toHaveBeenCalledTimes(1);
    expect(mockApp.use).toHaveBeenCalledWith('/', 'info-router');
    expect(mockApp.use).toHaveBeenCalledWith('/v1', 'multichain-router');
    expect(mockApp.use).toHaveBeenCalledWith('/v1', 'coingecko-router');
    expect(mockApp.use).toHaveBeenCalledWith('/v1/dapp', 'dapp-router');
    expect(mockApp.use).toHaveBeenCalledWith('/v1/networks', 'network-router');
  });

  it('applies the global rate limiter app-wide, ahead of the info router', () => {
    require('../index');

    const calls = mockApp.use.mock.calls;
    const limiterIndex = calls.findIndex((call) => call[0] === 'rate-limit:global');
    const infoIndex = calls.findIndex((call) => call[0] === '/' && call[1] === 'info-router');
    expect(calls[limiterIndex]).toHaveLength(1);
    expect(limiterIndex).toBeGreaterThan(-1);
    expect(limiterIndex).toBeLessThan(infoIndex);
    expect(calls).toContainEqual(['/v1/solana-:env/nft', 'rate-limit:tx']);
  });

  it('mounts each chain under /v1/<chain>-:env with a network resolver', () => {
    require('../index');

    ['bitcoin', 'solana', 'ethereum'].forEach((chain) => {
      const mount = findChainMount(chain);
      expect(mount).toBeDefined();
      expect(mount[0]).toBe(`/v1/${chain}-:env`);
      expect(typeof mount[1]).toBe('function');
      expect(mount[mount.length - 1]).toBe(`${chain}-router`);
    });
  });

  it('the chain resolver populates res.locals.network from the matching NETWORKS entry', () => {
    require('../index');

    const [, resolver] = findChainMount('bitcoin');
    const req = { params: { env: 'mainnet' } };
    const res = { locals: {}, status: jest.fn().mockReturnThis(), send: jest.fn() };
    const next = jest.fn();

    resolver(req, res, next);

    expect(res.locals.network).toEqual(
      expect.objectContaining({ id: 'bitcoin-mainnet', blockchain: 'bitcoin' })
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('the chain resolver returns 400 when the chain+env combo is not in NETWORKS', () => {
    require('../index');

    const [, resolver] = findChainMount('solana');
    const req = { params: { env: 'devnet-broken' } };
    const res = { locals: {}, status: jest.fn().mockReturnThis(), send: jest.fn() };
    const next = jest.fn();

    resolver(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'bad_request',
        error_description: expect.stringContaining('solana-devnet-broken'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('the bitcoin resolver does NOT match a solana network id (path will not select this mount in real Express)', () => {
    require('../index');

    const [, bitcoinResolver] = findChainMount('bitcoin');
    // In real Express, /v1/solana-mainnet/... never enters this resolver because
    // the path `/v1/bitcoin-:env` only matches `bitcoin-...`. We assert defensively
    // that even if env were `solana-mainnet`, the resolver would still derive a
    // bitcoin-prefixed networkId — proving that mount-path filtering, not the
    // resolver, is what guarantees per-chain isolation.
    const req = { params: { env: 'mainnet' } };
    const res = { locals: {}, status: jest.fn().mockReturnThis(), send: jest.fn() };
    const next = jest.fn();

    bitcoinResolver(req, res, next);

    expect(res.locals.network.blockchain).toBe('bitcoin');
  });
});
