'use strict';

/**
 * CloudWatch Embedded Metric Format over `console.log`: one JSON line per
 * emit, which CloudWatch Logs turns into metrics with no agent and no new
 * dependency. Never throws; `METRICS_DISABLED=true` (and Jest) silence it.
 */

const NAMESPACE = 'SalmonApi/Providers';

const unitFor = (name) => (name.endsWith('Ms') ? 'Milliseconds' : 'Count');

const isSilenced = () =>
  process.env.METRICS_DISABLED === 'true' || Boolean(process.env.JEST_WORKER_ID);

/**
 * @param {{ dimensions: Object<string,string>, metrics: Object<string,number>, namespace?: string }} payload
 */
const emit = ({ dimensions, metrics, namespace = NAMESPACE }) => {
  if (isSilenced()) return;
  try {
    const line = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [Object.keys(dimensions)],
            Metrics: Object.keys(metrics).map((Name) => ({ Name, Unit: unitFor(Name) })),
          },
        ],
      },
      ...dimensions,
      ...metrics,
    };
    console.log(JSON.stringify(line));
  } catch {
    // metrics must never take a request down
  }
};

module.exports = { emit, NAMESPACE };
