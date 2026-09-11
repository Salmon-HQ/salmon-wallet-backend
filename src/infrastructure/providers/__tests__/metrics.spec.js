'use strict';

const metrics = require('../metrics');

describe('metrics', () => {
  const worker = process.env.JEST_WORKER_ID;
  let log;
  beforeEach(() => {
    delete process.env.JEST_WORKER_ID;
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.JEST_WORKER_ID = worker;
    delete process.env.METRICS_DISABLED;
    log.mockRestore();
  });

  it('writes one EMF line with dimensions and units', () => {
    metrics.emit({
      dimensions: { Provider: 'coingecko', Environment: 'mainnet', Outcome: 'success' },
      metrics: { ProviderCalls: 1, ThrottleWaitMs: 12 },
    });
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0][0]);
    expect(line._aws.CloudWatchMetrics[0]).toEqual({
      Namespace: 'SalmonApi/Providers',
      Dimensions: [['Provider', 'Environment', 'Outcome']],
      Metrics: [
        { Name: 'ProviderCalls', Unit: 'Count' },
        { Name: 'ThrottleWaitMs', Unit: 'Milliseconds' },
      ],
    });
    expect(line).toMatchObject({ Provider: 'coingecko', ProviderCalls: 1, ThrottleWaitMs: 12 });
    expect(typeof line._aws.Timestamp).toBe('number');
  });

  it('never throws and honours METRICS_DISABLED', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => metrics.emit({ dimensions: { Provider: 'x' }, metrics: cyclic })).not.toThrow();
    process.env.METRICS_DISABLED = 'true';
    metrics.emit({ dimensions: { Provider: 'x' }, metrics: { ProviderCalls: 1 } });
    expect(log).toHaveBeenCalledTimes(0);
  });
});
