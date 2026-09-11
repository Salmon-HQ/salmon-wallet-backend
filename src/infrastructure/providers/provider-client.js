'use strict';

/**
 * The one door to every upstream provider. `providerCall` applies, in
 * order: request budget → circuit breaker → shared rate limit → timeout
 * (profile cap, never past the budget; the `signal` aborts the socket at the
 * deadline) → classified retry that only sleeps when the next attempt still
 * fits the budget → breaker bookkeeping → one EMF metrics line.
 *
 * Retryable = 429 / 5xx / network / timeout (`isRetryableError`). A 429
 * never counts toward opening the breaker: it is the provider's throttle,
 * not an outage.
 */

const { getProfile } = require('./profiles');
const { assertBudget, remainingMs } = require('./request-deadline');
const breaker = require('./circuit-breaker');
const limiter = require('./shared-rate-limiter');
const metrics = require('./metrics');
const { sleep } = require('../rate-limiting/rate-limiter');
const {
  isRetryableError,
  getRetryAfter,
  calculateBackoffDelay,
} = require('../rate-limiting/with-retry');

const outcomeOf = (error) => {
  if (!error) return 'success';
  if (error.errorCode) return error.errorCode;
  const status = error.response?.status;
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_5xx';
  if (status >= 400) return 'upstream_4xx';
  return 'network';
};

const countsAsOutage = (error) =>
  isRetryableError(error) && error.response?.status !== 429 && !error.errorCode;

const record = ({ name, environment, error, retries, throttleWaitMs, opened }) =>
  metrics.emit({
    dimensions: { Provider: name, Environment: environment, Outcome: outcomeOf(error) },
    metrics: {
      ProviderCalls: 1,
      ProviderErrors: error ? 1 : 0,
      Retries: retries,
      ThrottleWaitMs: throttleWaitMs,
      BreakerOpen: opened ? 1 : 0,
    },
  });

/**
 * @template T
 * @param {string} name - provider profile name.
 * @param {(ctx: { timeout: number, signal: AbortSignal }) => Promise<T>} fn
 * @param {{ locals?: Object, environment?: string, operationName?: string }} [options]
 *   `environment` overrides `locals.network.environment` for breaker scoping.
 * @returns {Promise<T>}
 */
const providerCall = async (name, fn, { locals, environment, operationName = name } = {}) => {
  const profile = getProfile(name);
  const env = environment || locals?.network?.environment || 'global';
  let retries = 0;
  let throttleWaitMs = 0;

  assertBudget(locals);
  try {
    await breaker.check(name, env, profile.breaker);
  } catch (error) {
    record({ name, environment: env, error, retries, throttleWaitMs, opened: true });
    throw error;
  }

  for (;;) {
    try {
      throttleWaitMs += await limiter.acquire(profile, locals);
      const timeout = Math.max(1, Math.min(profile.timeoutMs, remainingMs(locals)));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let result;
      try {
        result = await fn({ timeout, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      await breaker.recordSuccess(name, env, profile.breaker);
      record({ name, environment: env, retries, throttleWaitMs });
      return result;
    } catch (error) {
      const opened = countsAsOutage(error)
        ? await breaker.recordFailure(name, env, profile.breaker)
        : false;
      const canRetry =
        isRetryableError(error) && !error.errorCode && retries + 1 < profile.retry.maxAttempts;
      const retryAfter = profile.retry.honorRetryAfter ? getRetryAfter(error) : null;
      const delay =
        retryAfter ?? calculateBackoffDelay(retries, profile.retry.baseMs, 2, profile.retry.maxMs);
      if (!canRetry || delay >= remainingMs(locals)) {
        record({ name, environment: env, error, retries, throttleWaitMs, opened });
        throw error;
      }
      console.warn(
        `${operationName} failed with ${error.response?.status || error.code || 'network error'}, ` +
          `retrying in ${delay}ms (attempt ${retries + 1}/${profile.retry.maxAttempts})`
      );
      await sleep(delay);
      retries += 1;
    }
  }
};

module.exports = { providerCall, isRetryableError };
