'use strict';

const { createSink, createGa4Sink, toGa4Event } = require('../sink');

const RECORD = {
  event: 'swap_completed',
  props: { chain: 'solana', success: true, amount_bucket: '10-100' },
  ts: 1783979939147,
  received_at: 1783979979715,
  dt: '2026-07-13',
  install_id: 'install-abc',
  session_id: 'session-xyz',
  platform: 'mobile',
  app_version: '3.0.0',
};

describe('toGa4Event', () => {
  it('maps a record to an MP event with context and allow-listed props as params', () => {
    expect(toGa4Event(RECORD)).toEqual({
      name: 'swap_completed',
      params: {
        session_id: 'session-xyz',
        engagement_time_msec: 1,
        platform: 'mobile',
        app_version: '3.0.0',
        chain: 'solana',
        success: true,
        amount_bucket: '10-100',
      },
    });
  });
});

describe('createSink', () => {
  const original = process.env.ANALYTICS_SINK;
  afterEach(() => {
    if (original === undefined) delete process.env.ANALYTICS_SINK;
    else process.env.ANALYTICS_SINK = original;
  });

  it('returns the file sink by default', () => {
    delete process.env.ANALYTICS_SINK;
    expect(createSink().type).toBe('file');
  });

  it('returns the ga4 sink when ANALYTICS_SINK=ga4', () => {
    process.env.ANALYTICS_SINK = 'ga4';
    process.env.GA4_MEASUREMENT_ID = 'G-TEST';
    process.env.GA4_API_SECRET = 'secret';
    expect(createSink().type).toBe('ga4');
  });
});

describe('createGa4Sink', () => {
  let calls;

  beforeEach(() => {
    process.env.GA4_MEASUREMENT_ID = 'G-TEST';
    process.env.GA4_API_SECRET = 'secret';
    calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 204 };
    });
  });

  afterEach(() => {
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.GA4_API_SECRET;
    delete global.fetch;
  });

  it('throws if the credentials are missing', () => {
    delete process.env.GA4_API_SECRET;
    expect(() => createGa4Sink()).toThrow(/GA4_MEASUREMENT_ID and GA4_API_SECRET/);
  });

  it('posts to the MP endpoint with the measurement id and secret in the query', async () => {
    await createGa4Sink().putRecords([RECORD]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://www.google-analytics.com/mp/collect?measurement_id=G-TEST&api_secret=secret'
    );
  });

  it('uses install_id as the client_id and maps every event', async () => {
    await createGa4Sink().putRecords([RECORD]);
    expect(calls[0].body.client_id).toBe('install-abc');
    expect(calls[0].body.events).toEqual([toGa4Event(RECORD)]);
  });

  it('never forwards the user IP (no ip_override / user-ip fields)', async () => {
    await createGa4Sink().putRecords([RECORD]);
    expect(calls[0].body).not.toHaveProperty('ip_override');
    expect(calls[0].body).not.toHaveProperty('user_ip');
  });

  it('falls back to a generated client_id when install_id is empty', async () => {
    await createGa4Sink().putRecords([{ ...RECORD, install_id: '' }]);
    expect(calls[0].body.client_id).toEqual(expect.any(String));
    expect(calls[0].body.client_id.length).toBeGreaterThan(0);
  });

  it('splits batches larger than 25 events into separate requests', async () => {
    const many = Array.from({ length: 60 }, () => RECORD);
    await createGa4Sink().putRecords(many);
    expect(calls).toHaveLength(3); // 25 + 25 + 10
    expect(calls[0].body.events).toHaveLength(25);
    expect(calls[2].body.events).toHaveLength(10);
  });

  it('throws on a non-2xx response so the handler can fall back', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(createGa4Sink().putRecords([RECORD])).rejects.toThrow(/returned 500/);
  });

  it('does nothing on an empty batch', async () => {
    await createGa4Sink().putRecords([]);
    expect(calls).toHaveLength(0);
  });
});
