'use strict';

jest.mock('axios', () => ({
  post: jest.fn(),
}));

const http = require('axios');
const service = require('../bitcoin-broadcast-service');

describe('bitcoin-broadcast-service', () => {
  const locals = {
    network: {
      id: 'bitcoin-mainnet',
      blockchain: 'bitcoin',
      environment: 'mainnet',
    },
  };
  const expectedHeaders = {
    'X-API-Key': process.env.UBIQUITY_API_KEY,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts raw transactions to the Blockdaemon send endpoint', async () => {
    http.post.mockResolvedValue({
      data: { txid: 'broadcast-1' },
    });

    const result = await service.sendTransaction('deadbeef', locals);

    expect(http.post).toHaveBeenCalledWith(
      'https://svc.blockdaemon.com/universal/v1/bitcoin/mainnet/tx/send',
      { tx: 'deadbeef' },
      {
        headers: expectedHeaders,
        params: undefined,
        timeout: 15000,
      }
    );
    expect(result).toEqual({ txid: 'broadcast-1' });
  });

  describe('failure modes', () => {
    it('gives the broadcast enough time to reach the network', async () => {
      http.post.mockResolvedValue({ data: { txId: 'tx-1' } });

      await service.sendTransaction('raw-hex', locals);

      expect(http.post).toHaveBeenCalledWith(
        expect.any(String),
        { tx: 'raw-hex' },
        expect.objectContaining({ timeout: 15000 })
      );
    });

    it.each([
      [
        'a local abort',
        Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }),
      ],
      ['a provider 5xx', Object.assign(new Error('boom'), { response: { status: 503, data: {} } })],
      ['a connection failure', new Error('socket hang up')],
    ])('reports %s as an unknown outcome, not a failed send', async (_label, error) => {
      http.post.mockRejectedValue(error);

      // The transaction may already be relayed; telling the user it failed
      // invites them to rebuild and resend one that is in the mempool.
      await expect(service.sendTransaction('raw-hex', locals)).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'broadcast_status_unknown',
      });
    });

    it('lets a provider rejection through with its own status', async () => {
      const rejection = Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { error: 'TX decode failed' } },
      });
      http.post.mockRejectedValue(rejection);

      await expect(service.sendTransaction('raw-hex', locals)).rejects.toBe(rejection);
    });
  });
});
