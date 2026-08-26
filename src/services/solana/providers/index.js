'use strict';

/**
 * Provider resolver — wires Triton as primary and Helius as fallback.
 *
 * Routing model (post-cutover):
 *
 * - **Tx enrichment** (`getEnhancedTransactions`, `getEnhancedTransactionHistory`):
 *   Triton primary → Helius fallback (rate-limited via SOLANA_FALLBACK_MAX_RPS).
 *   Triton has no Enhanced Transactions equivalent; we ship a local parser that
 *   classifies tx via program-ID-driven instruction parsers. When the parser
 *   throws ProviderNotImplementedError or the network errors, the resolver
 *   admits up to `SOLANA_FALLBACK_MAX_RPS` Helius requests per second.
 *
 * - **DAS / NFTs** (`getNftMetadata`, `getNftMetadataBatch`, `getNftsByOwner`,
 *   `getNftByMint`):
 *   Triton primary → Helius fallback, using the same eligibility filter and the
 *   same `SOLANA_FALLBACK_MAX_RPS` budget as the tx surface. Triton DAS is the
 *   same JSON-RPC surface as Helius DAS, so either provider can serve the call.
 *   DAS failures propagate out of the provider so the fallback can fire; a
 *   provider returning an empty list or `null` means the indexer genuinely has
 *   nothing, never that the call failed. When Triton is not configured for the
 *   environment (e.g. devnet without `TRITON_RPC_URL_DEVNET`) the call goes
 *   straight to Helius.
 *
 * Logging: every dispatch emits a structured JSON line with provider, method,
 * latency, fallback usage, and error code. CloudWatch Insights can query these
 * via the Lambda log groups.
 *
 * Configuration env vars:
 * - `TRITON_RPC_URL`               — required for mainnet routing. Embed the
 *                                    token as a path segment (Triton convention)
 *                                    or pass `TRITON_API_TOKEN` separately.
 * - `TRITON_RPC_URL_DEVNET`        — optional; if unset devnet routes to public
 *                                    Solana endpoint (Helius for DAS)
 * - `TRITON_API_TOKEN`             — optional; appended as a path segment when
 *                                    the URL is bare. Most deployments embed
 *                                    the token in the URL and leave this unset.
 * - `SOLANA_FALLBACK_MAX_RPS`      — Helius free-tier guardrail (default 8)
 */

const heliusProvider = require('./helius-provider');
const tritonProvider = require('./triton-provider');
const tritonClient = require('../../../infrastructure/triton-client');
const heliusClient = require('../../../infrastructure/helius-client');
const { ProviderNotImplementedError } = require('./solana-data-provider');

const FALLBACK_MAX_RPS = parseInt(process.env.SOLANA_FALLBACK_MAX_RPS, 10) || 8;
const WINDOW_MS = 1000;

/**
 * Fixed-window token bucket used to cap Helius fallback traffic to
 * `SOLANA_FALLBACK_MAX_RPS` requests per `windowMs`.
 *
 * @param {number} maxRps - Max tokens (requests) allowed per window.
 * @param {number} windowMs - Window length in milliseconds.
 * @returns {{consume: () => boolean, reset: () => void}}
 *   `consume` returns true and decrements budget when a token is available,
 *   false when the window's budget is exhausted. `reset` clears the window
 *   (test-only escape hatch, exposed via `__testing.resetBudget`).
 */
const createTokenBucket = (maxRps, windowMs) => {
  let count = 0;
  let windowStart = Date.now();
  return {
    consume() {
      const now = Date.now();
      if (now - windowStart >= windowMs) {
        count = 0;
        windowStart = now;
      }
      if (count >= maxRps) return false;
      count += 1;
      return true;
    },
    reset() {
      count = 0;
      windowStart = Date.now();
    },
  };
};

const fallbackBucket = createTokenBucket(FALLBACK_MAX_RPS, WINDOW_MS);
/**
 * Attempts to consume one unit of the Helius-fallback rate budget.
 * @returns {boolean} true if capacity was available (request may proceed), false if the fallback window is exhausted
 */
const consumeFallbackBudget = () => fallbackBucket.consume();
/**
 * Resets the Helius-fallback rate budget window. Test/maintenance hook.
 * @returns {void}
 */
const resetBudget = () => fallbackBucket.reset();

const PRIMARY_NAME = tritonProvider.name;
const FALLBACK_NAME = heliusProvider.name;

const TRANSIENT_NET_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']);

/**
 * True for network-level failures (DNS, connection refused/reset, timeout,
 * or any axios error with no `response` at all) — the class of errors that
 * should always trigger fallback to Helius regardless of HTTP status.
 * @param {Error} error
 * @returns {boolean}
 */
const isTransientNetwork = (error) => {
  if (TRANSIENT_NET_CODES.has(error?.code)) return true;
  // axios with no response = network error (DNS, dropped connection, etc.)
  return !error?.response;
};

/**
 * True when the HTTP status on `error.response` warrants falling back to
 * Helius: 5xx, 429 (rate limited), or 401/403 (likely a Triton config issue —
 * see inline note below on why we still fall back rather than surface it).
 * @param {Error} error
 * @returns {boolean}
 */
const isFallbackHttpStatus = (error) => {
  const status = error?.response?.status;
  if (!status) return false;
  if (status >= 500) return true;
  if (status === 429) return true;
  // 401/403: likely TRITON_API_TOKEN or IP allowlist misconfig. We still fall
  // back so the user-facing call succeeds; the dispatch tags `auth_error: true`
  // so CloudWatch alerts can distinguish config bugs from transient outages.
  if (status === 401 || status === 403) return true;
  return false;
};

/**
 * Decide whether a Triton (primary) failure should trigger the Helius
 * fallback path, vs. surfacing straight to the caller. Eligible: the
 * provider explicitly signaled `ProviderNotImplementedError` or
 * `TRITON_NOT_CONFIGURED`, a fallback-worthy HTTP status, or a transient
 * network error. Other 4xx errors are treated as caller-side and are not
 * eligible, so fallback budget isn't burned on bad requests.
 * @param {Error} error
 * @returns {boolean}
 */
const isFallbackEligibleError = (error) => {
  if (!error) return false;
  if (error instanceof ProviderNotImplementedError) return true;
  if (error.code === 'TRITON_NOT_CONFIGURED') return true;
  if (isFallbackHttpStatus(error)) return true;
  if (isTransientNetwork(error)) return true;
  // Other 4xx (caller-side errors) — surface them rather than burn fallback.
  return false;
};

const isAuthError = (error) => {
  const status = error?.response?.status;
  return status === 401 || status === 403;
};

/**
 * Last-arg env extractor. Tx methods carry environment as the trailing string
 * argument; NFT methods carry it inside `locals.network.environment`. We
 * normalize both shapes here so the resolver can pick the correct primary
 * configuration without per-method branches.
 */
const extractEnvironment = (method, args) => {
  if (method === 'getNftsByOwner') {
    const locals = args[2];
    return locals?.network?.environment || 'mainnet';
  }
  if (method === 'getNftByMint') {
    const locals = args[1];
    return locals?.network?.environment || 'mainnet';
  }
  // tx methods: env is the last arg
  const last = args[args.length - 1];
  return typeof last === 'string' ? last : 'mainnet';
};

/**
 * Redact the Triton API token from any string before logging. Triton URLs
 * embed the token as a path segment (`...rpcpool.com/<TOKEN>`); some axios /
 * RPC error messages echo the request URL back, which would leak the secret
 * to CloudWatch.
 */
const redact = (value) => {
  if (typeof value !== 'string' || !value) return value;
  let safe = value;
  const token = tritonClient.getApiToken();
  if (token) {
    safe = safe.split(token).join('[REDACTED]');
  }
  // Belt-and-braces: redact long base58/UUID-shaped path segments behind
  // rpcpool.com regardless of TRITON_API_TOKEN being set.
  safe = safe.replace(/(\.rpcpool\.com)\/[A-Za-z0-9_-]{8,}/g, '$1/[REDACTED]');
  return safe;
};

/**
 * Apply `redact` to the log fields that may echo a Triton URL/token
 * (`error_message`, `reason`) before a payload reaches `log`.
 * @param {Object} payload
 * @returns {Object} Shallow copy of `payload` with sensitive fields redacted.
 */
const sanitizePayload = (payload) => {
  const out = { ...payload };
  if (out.error_message) out.error_message = redact(out.error_message);
  if (out.reason) out.reason = redact(out.reason);
  return out;
};

/**
 * Emit a single-line structured JSON log entry (CloudWatch Insights-friendly)
 * for a resolver dispatch event, after redacting sensitive fields.
 * @param {'info'|'warn'|'error'} level
 * @param {Object} payload
 * @returns {void}
 */
const log = (level, payload) => {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  // Single-line JSON keeps CloudWatch Insights happy.
  fn(JSON.stringify({ component: 'solana-provider-resolver', ...sanitizePayload(payload) }));
};

const errorCode = (error) => error?.code || 'UNKNOWN';

/**
 * Invoke `fn`, timing the call and normalizing both success and failure into a
 * single result shape so dispatch logic doesn't need try/catch at every call site.
 * @param {() => Promise<*>} fn
 * @returns {Promise<{ok: true, result: *, latency: number}|{ok: false, error: Error, latency: number}>}
 */
const tryRun = async (fn) => {
  const t0 = Date.now();
  try {
    return { ok: true, result: await fn(), latency: Date.now() - t0 };
  } catch (error) {
    return { ok: false, error, latency: Date.now() - t0 };
  }
};

/**
 * `tryRun` bound to a provider method call.
 * @param {Object} provider - A SolanaDataProvider implementation.
 * @param {string} method - Method name to invoke on `provider`.
 * @param {Array} args - Arguments to spread into the method call.
 */
const tryProvider = (provider, method, args) => tryRun(() => provider[method](...args));

/**
 * Shared Triton → Helius dispatch. Runs `primary`; on a fallback-eligible
 * failure, and only while the `SOLANA_FALLBACK_MAX_RPS` budget allows, runs
 * `fallback`. Every outcome emits one structured JSON log line built from
 * `baseLog`. When Triton is not configured for the environment, `primary` is
 * skipped entirely.
 *
 * @param {{method: string, env: string, surface?: string}} baseLog
 * @param {() => Promise<Object>} primary - Thunk returning a `tryRun` result.
 * @param {() => Promise<Object>} fallback - Thunk returning a `tryRun` result.
 * @returns {Promise<*>} The successful attempt's result.
 * @throws {Error} The primary error when the fallback is not eligible or the
 *   budget is exhausted; the fallback error when the fallback also fails.
 */
const dispatchWithFallback = async (baseLog, primary, fallback) => {
  if (!tritonClient.isConfigured(baseLog.env)) {
    const out = await fallback();
    if (out.ok) {
      log('info', {
        ...baseLog,
        provider: FALLBACK_NAME,
        latency_ms: out.latency,
        fallback_used: false,
        reason: 'triton_not_configured',
      });
      return out.result;
    }
    log('error', {
      ...baseLog,
      provider: FALLBACK_NAME,
      latency_ms: out.latency,
      error_code: errorCode(out.error),
      error_message: out.error.message,
    });
    throw out.error;
  }

  const primaryOut = await primary();
  if (primaryOut.ok) {
    log('info', {
      ...baseLog,
      provider: PRIMARY_NAME,
      latency_ms: primaryOut.latency,
      fallback_used: false,
    });
    return primaryOut.result;
  }

  const primaryError = primaryOut.error;
  const primaryPayload = {
    ...baseLog,
    provider: PRIMARY_NAME,
    latency_ms: primaryOut.latency,
    error_code: errorCode(primaryError),
    error_message: primaryError.message,
  };

  if (!isFallbackEligibleError(primaryError)) {
    log('error', { ...primaryPayload, fallback_eligible: false });
    throw primaryError;
  }

  if (!consumeFallbackBudget()) {
    log('warn', {
      ...primaryPayload,
      fallback_used: false,
      fallback_blocked: true,
      reason: `budget_exhausted_max_${FALLBACK_MAX_RPS}_rps`,
    });
    throw primaryError;
  }

  log('warn', {
    ...primaryPayload,
    fallback_used: true,
    fallback_provider: FALLBACK_NAME,
    auth_error: isAuthError(primaryError) || undefined,
  });

  const fallbackOut = await fallback();
  if (fallbackOut.ok) {
    log('info', {
      ...baseLog,
      provider: FALLBACK_NAME,
      latency_ms: fallbackOut.latency,
      fallback_used: true,
    });
    return fallbackOut.result;
  }
  log('error', {
    ...baseLog,
    provider: FALLBACK_NAME,
    latency_ms: fallbackOut.latency,
    error_code: errorCode(fallbackOut.error),
    error_message: fallbackOut.error.message,
    fallback_used: true,
    fallback_failed: true,
  });
  throw fallbackOut.error;
};

/** Tx enrichment dispatch: Triton primary → Helius fallback. */
const dispatchTx =
  (method) =>
  async (...args) =>
    dispatchWithFallback(
      { method, env: extractEnvironment(method, args) },
      () => tryProvider(tritonProvider, method, args),
      () => tryProvider(heliusProvider, method, args)
    );

/** DAS dispatch: same routing as `dispatchTx`, tagged `surface: 'das'` in the logs. */
const dispatchDas =
  (method) =>
  async (...args) =>
    dispatchWithFallback(
      { method, env: extractEnvironment(method, args), surface: 'das' },
      () => tryProvider(tritonProvider, method, args),
      () => tryProvider(heliusProvider, method, args)
    );

const resolver = {
  name: 'resolver',
  primaryName: PRIMARY_NAME,
  fallbackName: FALLBACK_NAME,

  /**
   * Resolve the RPC URL for `environment`: Triton when configured (falling
   * back to Helius on a fallback-eligible error, budget permitting), else
   * Helius directly.
   * @param {string} environment
   * @returns {string} JSON-RPC URL.
   * @throws {Error} When Triton fails with a non-eligible error, or the
   *   fallback budget is exhausted.
   */
  getRpcUrl: (environment) => {
    if (!tritonClient.isConfigured(environment)) {
      return heliusProvider.getRpcUrl(environment);
    }
    try {
      return tritonProvider.getRpcUrl(environment);
    } catch (error) {
      if (!isFallbackEligibleError(error) || !consumeFallbackBudget()) {
        throw error;
      }
      return heliusProvider.getRpcUrl(environment);
    }
  },

  /**
   * Run a DAS read that has to talk to an RPC URL directly instead of going
   * through the provider methods below — the Umi / `dasApi` path used by the
   * compressed-NFT burn and transfer builders, where the whole operation
   * (`getAsset` + `getAssetProof` + canopy truncation) lives inside
   * mpl-bubblegum and cannot be split per method.
   *
   * `run(rpcUrl)` is invoked with Triton's URL and retried with Helius' URL
   * under the same eligibility filter, rate budget and structured logging as
   * every other dispatch.
   *
   * @param {string} method - Label for the log line, e.g. 'getAssetWithProof'.
   * @param {string} environment - Solana cluster.
   * @param {(rpcUrl: string) => Promise<*>} run
   * @returns {Promise<*>} Whatever `run` resolves to.
   */
  dispatchDasRpc: (method, environment, run) =>
    dispatchWithFallback(
      { method, env: environment, surface: 'das' },
      () => tryRun(() => run(tritonProvider.getRpcUrl(environment))),
      () => tryRun(() => run(heliusProvider.getRpcUrl(environment)))
    ),

  isTransactionParsed: heliusProvider.isTransactionParsed,

  /**
   * True when either Triton or Helius can serve enhanced transactions for the
   * given environment. Mainnet/devnet typically pass; testnet is enhanced-only
   * when neither provider supports it (currently always false).
   *
   * Replaces the direct `isEnhancedApiSupported` import in the service layer
   * so the gate stays provider-agnostic.
   */
  isEnhancedApiSupported: (environment) => {
    if (tritonClient.isConfigured(environment)) return true;
    return heliusClient.isEnhancedApiSupported(environment);
  },

  // Tx enrichment surface — Triton primary + Helius fallback
  getEnhancedTransactions: dispatchTx('getEnhancedTransactions'),
  getEnhancedTransactionHistory: dispatchTx('getEnhancedTransactionHistory'),

  // DAS surface — Triton primary + Helius fallback
  getNftMetadata: dispatchDas('getNftMetadata'),
  getNftMetadataBatch: dispatchDas('getNftMetadataBatch'),
  getNftsByOwner: dispatchDas('getNftsByOwner'),
  getNftByMint: dispatchDas('getNftByMint'),
};

module.exports = {
  ...resolver,
  __testing: {
    resetBudget,
    consumeFallbackBudget,
    isFallbackEligibleError,
    extractEnvironment,
    redact,
    sanitizePayload,
  },
};
