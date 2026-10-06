'use strict';

/**
 * Provider resolver — every Solana chain-data call goes to Triton One. There
 * is no second provider: a Triton failure surfaces to the caller (the
 * provider client already turns repeated failures into a 503
 * `upstream_unavailable`). Transaction history keeps its own degraded tier —
 * unclassified bare-RPC reads in `solana-transaction-service`.
 *
 * - **Tx enrichment** (`getEnhancedTransactions`, `getEnhancedTransactionHistory`):
 *   Triton RPC + Salmon's local parser, which classifies transactions by the
 *   programs they invoke and emits the canonical enriched shape.
 * - **DAS / NFTs** (`getNftMetadata`, `getNftMetadataBatch`, `getNftsByOwner`,
 *   `getNftByMint`): Triton DAS. A provider returning an empty list or `null`
 *   means the indexer genuinely has nothing, never that the call failed.
 *
 * Logging: every dispatch emits a structured JSON line with provider, method,
 * latency and error code. CloudWatch Insights can query these via the Lambda
 * log groups.
 *
 * Configuration env vars:
 * - `TRITON_RPC_URL`         — required for mainnet. Embed the token as a path
 *                              segment (Triton convention) or pass
 *                              `TRITON_API_TOKEN` separately.
 * - `TRITON_RPC_URL_DEVNET`  — optional; unset routes devnet to the public
 *                              Solana devnet endpoint (no DAS there).
 * - `TRITON_API_TOKEN`       — optional; appended as a path segment when the
 *                              URL is bare.
 */

const tritonProvider = require('./triton-provider');
const tritonClient = require('../../../infrastructure/triton-client');

const PROVIDER_NAME = tritonProvider.name;

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
 * Run `fn` against Triton, emitting one structured log line per outcome.
 * @param {{method: string, env: string, surface?: string}} baseLog
 * @param {() => Promise<*>} fn
 * @returns {Promise<*>} Whatever `fn` resolves to.
 * @throws {Error} Triton's error, unchanged.
 */
const dispatch = async (baseLog, fn) => {
  const t0 = Date.now();
  try {
    const result = await fn();
    log('info', { ...baseLog, provider: PROVIDER_NAME, latency_ms: Date.now() - t0 });
    return result;
  } catch (error) {
    log('error', {
      ...baseLog,
      provider: PROVIDER_NAME,
      latency_ms: Date.now() - t0,
      error_code: errorCode(error),
      error_message: error.message,
    });
    throw error;
  }
};

/** Bind a provider method to `dispatch`; DAS methods are tagged `surface: 'das'`. */
const route =
  (method, surface) =>
  (...args) =>
    dispatch({ method, env: extractEnvironment(method, args), surface }, () =>
      tritonProvider[method](...args)
    );

const resolver = {
  name: 'resolver',
  primaryName: PROVIDER_NAME,

  /**
   * @param {string} environment
   * @returns {string} Triton JSON-RPC URL for `environment`.
   * @throws {Error} `TRITON_NOT_CONFIGURED` on mainnet without `TRITON_RPC_URL`.
   */
  getRpcUrl: (environment) => tritonProvider.getRpcUrl(environment),

  /**
   * Run a DAS read that has to talk to an RPC URL directly instead of going
   * through the provider methods below — the Umi / `dasApi` path used by the
   * compressed-NFT burn and transfer builders, where the whole operation
   * (`getAsset` + `getAssetProof` + canopy truncation) lives inside
   * mpl-bubblegum and cannot be split per method.
   *
   * @param {string} method - Label for the log line, e.g. 'getAssetWithProof'.
   * @param {string} environment - Solana cluster.
   * @param {(rpcUrl: string) => Promise<*>} run
   * @returns {Promise<*>} Whatever `run` resolves to.
   */
  dispatchDasRpc: (method, environment, run) =>
    dispatch({ method, env: environment, surface: 'das' }, () =>
      run(tritonProvider.getRpcUrl(environment))
    ),

  /**
   * True when Triton is configured for `environment`, i.e. the enriched
   * history path can run. Testnet is never Triton-hosted, so it reads the
   * bare RPC.
   */
  isEnhancedApiSupported: (environment) => tritonClient.isConfigured(environment),

  getEnhancedTransactions: route('getEnhancedTransactions'),
  getEnhancedTransactionHistory: route('getEnhancedTransactionHistory'),

  getNftMetadata: route('getNftMetadata', 'das'),
  getNftMetadataBatch: route('getNftMetadataBatch', 'das'),
  getNftsByOwner: route('getNftsByOwner', 'das'),
  getNftByMint: route('getNftByMint', 'das'),
};

module.exports = {
  ...resolver,
  __testing: {
    extractEnvironment,
    redact,
    sanitizePayload,
  },
};
