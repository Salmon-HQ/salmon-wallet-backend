'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (_resource, data) => data),
}));
jest.mock('../../../services/solana/solana-nft-service', () => ({
  list: jest.fn(),
  filterSpam: jest.fn((nfts) => ({
    data: nfts.filter((nft) => nft),
    hidden: { spam: 0, fungible: 0 },
  })),
  find: jest.fn(),
  createBurnTransaction: jest.fn(),
}));

const controller = require('../solana-nft-controller');
const service = require('../../../services/solana/solana-nft-service');
const {
  UnsupportedSolanaNftBurnError,
} = require('../../../services/solana/solana-nft-burn-errors');

const createRes = () => ({
  locals: { network: { id: 'solana-mainnet' } },
  status: jest.fn().mockReturnThis(),
  send: jest.fn(),
  json: jest.fn(),
});

describe('solana-nft-controller', () => {
  describe('address validation', () => {
    const buildRes = () => ({
      locals: { network: { id: 'solana-mainnet' } },
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it.each([
      ['list', 'list', { query: { publicKey: 'not-base58!' }, params: {} }],
      [
        'burnTransaction',
        'burnTransaction',
        { query: { owner: 'not-base58!' }, params: { mintAddress: 'mint' } },
      ],
      [
        'transferTransaction',
        'transferTransaction',
        {
          query: { owner: 'not-base58!', destination: 'not-base58!' },
          params: { mintAddress: 'mint' },
        },
      ],
    ])('%s answers 400 instead of letting PublicKey throw a 500', async (_label, handler, req) => {
      const res = buildRes();

      await controller[handler](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'bad_request' }));
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists decorated NFTs with pagination', async () => {
    service.list.mockResolvedValue({
      data: [{ mint: { address: '2jmaywRjUsGyQf6qBaWn8PeFg4HrbavbVq1dqyRMM2FE' } }],
      pagination: { total: 1 },
    });
    const res = createRes();

    await controller.list(
      { query: { publicKey: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR' } },
      res
    );

    expect(service.list).toHaveBeenCalledWith(
      { publicKey: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR' },
      res.locals
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      data: [{ mint: { address: '2jmaywRjUsGyQf6qBaWn8PeFg4HrbavbVq1dqyRMM2FE' } }],
      pagination: { total: 1, hidden: { spam: 0, fungible: 0 } },
    });
  });

  it('reports per-page hidden counts next to the provider pagination', async () => {
    const page = [
      { mint: 'a' },
      { mint: 'b' },
      { mint: 'c' },
      { mint: 's1' },
      { mint: 's2' },
      null,
    ];
    service.list.mockResolvedValue({
      data: page,
      pagination: { total: 6, limit: 50, offset: 0, hasMore: false, nextOffset: null },
    });
    service.filterSpam.mockImplementationOnce((nfts) => ({
      data: nfts.slice(0, 3),
      hidden: { spam: 2, fungible: 1 },
    }));
    const res = createRes();

    await controller.list(
      { query: { publicKey: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR' } },
      res
    );

    expect(res.send).toHaveBeenCalledWith({
      data: page.slice(0, 3),
      pagination: {
        total: 6,
        limit: 50,
        offset: 0,
        hasMore: false,
        nextOffset: null,
        hidden: { spam: 2, fungible: 1 },
      },
    });
  });

  it('passes includeSpam through so hidden.spam is 0 when spam is kept', async () => {
    service.list.mockResolvedValue({ data: [{ mint: 'a' }], pagination: { total: 1 } });
    service.filterSpam.mockImplementationOnce((nfts, includeSpam) => ({
      data: nfts,
      hidden: { spam: includeSpam ? 0 : 1, fungible: 0 },
    }));
    const res = createRes();

    await controller.list(
      { query: { publicKey: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR', includeSpam: 'true' } },
      res
    );

    expect(service.filterSpam).toHaveBeenCalledWith(expect.any(Array), true);
    expect(res.send.mock.calls[0][0].pagination.hidden).toEqual({ spam: 0, fungible: 0 });
  });

  describe('debug flag', () => {
    const publicKey = '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR';
    const raw = [
      { mint: { address: 'a' }, metadataResolved: false, collection: { key: 'c', verified: true } },
      { mint: { address: 'b' } },
    ];

    it('leaves the item shape untouched without the flag', async () => {
      service.list.mockResolvedValue({ data: raw, pagination: {} });
      const res = createRes();

      await controller.list({ query: { publicKey } }, res);

      expect(res.send.mock.calls[0][0].data).toEqual(raw);
    });

    it('annotates survivors with metadataResolved and collectionVerified', async () => {
      service.list.mockResolvedValue({ data: raw, pagination: {} });
      const res = createRes();

      await controller.list({ query: { publicKey, debug: '1' } }, res);

      expect(res.send.mock.calls[0][0].data).toEqual([
        { ...raw[0], metadataResolved: false, collectionVerified: true },
        { ...raw[1], metadataResolved: true, collectionVerified: null },
      ]);
    });

    it('still drops spam with the flag when includeSpam is off', async () => {
      service.list.mockResolvedValue({ data: raw, pagination: {} });
      service.filterSpam.mockImplementationOnce((nfts) => ({
        data: nfts.slice(0, 1),
        hidden: { spam: 1, fungible: 0 },
      }));
      const res = createRes();

      await controller.list({ query: { publicKey, debug: '1' } }, res);

      expect(service.filterSpam).toHaveBeenCalledWith(expect.any(Array), false);
      expect(res.send.mock.calls[0][0].data).toHaveLength(1);
    });
  });

  it('returns 404 when list service has no data', async () => {
    service.list.mockResolvedValue(null);
    const res = createRes();

    await controller.list(
      { query: { publicKey: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'nfts_not_found',
      error_description: 'NFTs not found',
    });
  });

  it('returns 400 when publicKey query parameter is missing', async () => {
    const res = createRes();

    await controller.list({ query: {} }, res);

    expect(service.list).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'bad_request',
      error_description: 'publicKey query parameter is required.',
    });
  });

  it('creates burn transactions and maps burn errors to HTTP responses', async () => {
    service.createBurnTransaction.mockResolvedValueOnce({ transaction: 'tx' });
    const successRes = createRes();

    await controller.burnTransaction(
      {
        params: { mintAddress: '2jmaywRjUsGyQf6qBaWn8PeFg4HrbavbVq1dqyRMM2FE' },
        query: { owner: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR' },
      },
      successRes
    );

    expect(service.createBurnTransaction).toHaveBeenCalledWith(
      '2jmaywRjUsGyQf6qBaWn8PeFg4HrbavbVq1dqyRMM2FE',
      '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR',
      successRes.locals
    );
    expect(successRes.status).toHaveBeenCalledWith(200);
    expect(successRes.send).toHaveBeenCalledWith({ transaction: 'tx' });

    const missingOwnerRes = createRes();
    await controller.burnTransaction(
      { params: { mintAddress: '2jmaywRjUsGyQf6qBaWn8PeFg4HrbavbVq1dqyRMM2FE' }, query: {} },
      missingOwnerRes
    );
    expect(missingOwnerRes.status).toHaveBeenCalledWith(400);
    expect(missingOwnerRes.json).toHaveBeenCalledWith({
      error: 'bad_request',
      error_description: 'owner query parameter is required.',
    });

    service.createBurnTransaction.mockRejectedValueOnce(
      new UnsupportedSolanaNftBurnError('Unsupported token')
    );
    const errorRes = createRes();
    await controller.burnTransaction(
      {
        params: { mintAddress: '2jmaywRjUsGyQf6qBaWn8PeFg4HrbavbVq1dqyRMM2FE' },
        query: { owner: '7ZUYPJfyPj8gBvwCeCpq9EhDwB5x8kJK8S966NvwKKuR' },
      },
      errorRes
    );
    expect(errorRes.status).toHaveBeenCalledWith(422);
    expect(errorRes.json).toHaveBeenCalledWith({
      error: 'burn_not_supported',
      error_description: 'Unsupported token',
    });
  });
});
