'use strict';

jest.mock('../sink');

const { createSink } = require('../sink');
const { handler } = require('../handler');

const records = [];

beforeEach(() => {
  records.length = 0;
  createSink.mockReturnValue({
    type: 'mock',
    putRecords: async (recs) => {
      records.push(...recs);
    },
  });
});

function apiEvent(body, { method = 'POST', sourceIp = '203.0.113.9' } = {}) {
  return {
    httpMethod: method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    requestContext: { identity: { sourceIp } },
    headers: { 'X-Forwarded-For': sourceIp },
  };
}

describe('analytics ingest handler', () => {
  it('accepts a valid batch and returns 202 with a count', async () => {
    const res = await handler(
      apiEvent({
        context: { installId: 'abc', sessionId: 'sess', platform: 'web', appVersion: '3.0.0' },
        events: [
          {
            event: 'swap_completed',
            props: { from_chain: 'solana', to_chain: 'solana', success: true },
            ts: 1,
          },
        ],
      })
    );

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ accepted: 1, rejected: 0 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: 'swap_completed',
      install_id: 'abc',
      platform: 'web',
    });
  });

  it.each([
    ['plain semver', '1.0.2', '1.0.2'],
    ['a prerelease', '0.10.0-beta.1', '0.10.0-beta.1'],
    ['a non-semver string', 'banana', ''],
    ['a partial version', '1.0', ''],
    ['a missing version', undefined, ''],
    ['a non-string', 42, ''],
  ])('records %s as %j', async (_label, appVersion, expected) => {
    await handler(
      apiEvent({
        context: { installId: 'abc', platform: 'web', appVersion },
        events: [{ event: 'send_completed' }],
      })
    );
    expect(records[0].app_version).toBe(expected);
  });

  it('never stores the client IP', async () => {
    await handler(
      apiEvent({
        context: { installId: 'abc', platform: 'mobile', appVersion: '3.0.0' },
        events: [{ event: 'send_completed' }],
      })
    );
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain('203.0.113.9');
    expect(records[0].ip).toBeUndefined();
    expect(records[0].sourceIp).toBeUndefined();
  });

  it('rejects a batch whose only event carries an address', async () => {
    const res = await handler(
      apiEvent({
        context: { platform: 'web' },
        events: [
          {
            event: 'send_completed',
            props: { chain: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' },
          },
        ],
      })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('no_valid_events');
    expect(records).toHaveLength(0);
  });

  it('drops invalid events but keeps valid ones', async () => {
    const res = await handler(
      apiEvent({
        context: { platform: 'web' },
        events: [
          { event: 'nft_viewed' },
          { event: 'send_completed', props: { chain: 'dogecoin' } },
        ],
      })
    );
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ accepted: 1, rejected: 1 });
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe('nft_viewed');
  });

  it('requires an events array', async () => {
    const res = await handler(apiEvent({ context: {} }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('events_array_required');
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await handler(apiEvent('{not json', {}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_json');
  });

  it('handles CORS preflight and rejects non-POST', async () => {
    expect((await handler(apiEvent({}, { method: 'OPTIONS' }))).statusCode).toBe(204);
    expect((await handler(apiEvent({}, { method: 'GET' }))).statusCode).toBe(405);
  });

  describe('batch cap accounting', () => {
    it('counts events dropped past the batch cap as rejected', async () => {
      const events = Array.from({ length: 150 }, () => ({
        event: 'wallet_created',
        props: { chain: 'solana' },
      }));

      const response = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ events, context: { platform: 'mobile' } }),
      });

      // Reporting 100 accepted / 0 rejected hid the 50 dropped events from
      // both sides.
      expect(JSON.parse(response.body)).toEqual({ accepted: 100, rejected: 50 });
    });
  });
});
