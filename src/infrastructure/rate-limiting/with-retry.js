'use strict';

/**
 * Shared retry-with-backoff helper for the per-provider rate limiters.
 *
 * Each provider wraps `createWithRetry({...})` with its own defaults
 * (max retries, base delay, ceiling). The factory returns a `withRetry`
 * function with the provider's defaults baked in; callers can still pass
 * per-call overrides via the second argument.
 *
 * Retry policy:
 *   - HTTP 429 and 5xx → retry
 *   - Network error (no `error.response`) → retry
 *   - Anything else → throw immediately
 *
 * If a `retry-after` header is present (CoinGecko / Helius), it overrides
 * the exponential-backoff schedule for that single attempt.
 */

const { sleep } = require('./rate-limiter');

/**
 * Exponential backoff delay for a given retry attempt, capped at `maxDelay`.
 * @param {number} attempt - zero-based retry attempt number.
 * @param {number} initialDelay - base delay in ms.
 * @param {number} multiplier - exponential growth factor per attempt.
 * @param {number} maxDelay - ceiling in ms.
 * @returns {number} delay in ms.
 */
const calculateBackoffDelay = (attempt, initialDelay, multiplier, maxDelay) => {
  const delay = initialDelay * Math.pow(multiplier, attempt);
  return Math.min(delay, maxDelay);
};

/**
 * Whether `error` should trigger a retry: network errors (no response) and
 * HTTP 429/5xx are retryable; any other status is not.
 * @param {Error & {response?: {status: number}}} error
 * @returns {boolean}
 */
const isRetryableError = (error) => {
  if (!error.response) return true;
  const status = error.response.status;
  return status === 429 || (status >= 500 && status < 600);
};

/**
 * Read a `retry-after` header in either of the two formats the spec allows:
 * an integer number of seconds, or an HTTP date.
 * @param {Error} error
 * @returns {number|null} delay in milliseconds, or null when no header found
 */
const getRetryAfter = (error) => {
  if (!error.response || !error.response.headers) return null;

  const retryAfter = error.response.headers['retry-after'];
  if (!retryAfter) return null;

  const seconds = parseInt(retryAfter, 10);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  const retryDate = new Date(retryAfter);
  if (!Number.isNaN(retryDate.getTime())) {
    return Math.max(0, retryDate.getTime() - Date.now());
  }

  return null;
};

/**
 * Build a retry helper preconfigured for one provider.
 *
 * @param {Object} defaults
 * @param {number} defaults.maxRetries
 * @param {number} defaults.initialDelay
 * @param {number} defaults.maxDelay
 * @param {number} [defaults.backoffMultiplier=2]
 * @param {string} [defaults.operationName='API request']
 * @param {boolean} [defaults.honorRetryAfter=false] - read `retry-after` header
 * @returns {function} withRetry(requestFn, options?) → Promise<result>
 */
const createWithRetry = (defaults) => {
  const {
    maxRetries: defaultMaxRetries,
    initialDelay: defaultInitialDelay,
    maxDelay: defaultMaxDelay,
    backoffMultiplier: defaultBackoffMultiplier = 2,
    operationName: defaultOperationName = 'API request',
    honorRetryAfter = false,
  } = defaults;

  return async function withRetry(requestFn, options = {}) {
    const {
      maxRetries = defaultMaxRetries,
      initialDelay = defaultInitialDelay,
      maxDelay = defaultMaxDelay,
      backoffMultiplier = defaultBackoffMultiplier,
      operationName = defaultOperationName,
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const result = await requestFn();
        if (attempt > 0) {
          console.info(`${operationName} succeeded on attempt ${attempt + 1}/${maxRetries + 1}`);
        }
        return result;
      } catch (error) {
        lastError = error;

        const shouldRetry = isRetryableError(error) && attempt < maxRetries;
        if (!shouldRetry) {
          const status = error.response?.status || 'network error';
          if (attempt > 0) {
            console.error(
              `${operationName} failed permanently with ${status} after ${attempt + 1} attempts`
            );
          }
          throw error;
        }

        const retryAfterDelay = honorRetryAfter ? getRetryAfter(error) : null;
        const delay =
          retryAfterDelay ||
          calculateBackoffDelay(attempt, initialDelay, backoffMultiplier, maxDelay);

        const status = error.response?.status || 'network error';
        const retrySource = retryAfterDelay ? '(from retry-after header)' : '(exponential backoff)';

        console.warn(
          `${operationName} failed with ${status}, retrying in ${delay}ms ${retrySource} ` +
            `(attempt ${attempt + 1}/${maxRetries + 1})`
        );

        await sleep(delay);
      }
    }

    console.error(`${operationName} exhausted all ${maxRetries + 1} attempts`);
    throw lastError;
  };
};

module.exports = {
  createWithRetry,
  isRetryableError,
  getRetryAfter,
  calculateBackoffDelay,
};
