'use strict';

/**
 * Final Express error-handling middleware (4-arg signature).
 *
 * Three sources of truth for the response status, in order:
 *   1. `err.statusCode` / `err.errorCode` — errors the domain raised on
 *      purpose (e.g. `SolanaNftTransferError`).
 *   2. `err.response.status` — an upstream provider (Jupiter, Blockdaemon,
 *      an RPC node) rejected the request. A 400/404/422 there
 *      means the *caller* sent something the provider refused, so answering
 *      500 both lies to the client and turns every invalid transaction into a
 *      fake backend incident in the logs. Auth/rate-limit/5xx failures stay
 *      500: those are our credentials or the provider being down, and the
 *      caller can do nothing about them.
 *   3. Anything else — 500 `server_error`.
 *
 * The error envelope is the repo-wide
 * `{ error: '<snake_case_code>', error_description }` shape.
 */

const UPSTREAM_CLIENT_ERRORS = {
  400: 'bad_request',
  404: 'not_found',
  422: 'unprocessable_entity',
};

// Where each provider hides its human-readable reason. Jupiter and Blockdaemon
// use flat `message`/`error`; other providers nest it under `{err: {kind,
// details}}`. Without this the client only ever saw axios's "Request failed
// with status code 400", which the wallet cannot classify into a useful
// message.
const UPSTREAM_MESSAGE_PATHS = [
  (data) => data.message,
  (data) => data.error_description,
  (data) => data.description,
  (data) => data.detail,
  (data) => data.error,
  (data) => data.error?.message,
  (data) => data.err?.details,
  (data) => data.err?.kind,
];

/**
 * Best-effort human message from an upstream error body, falling back to the
 * error's own message. Only strings are accepted — an upstream body can be an
 * object or HTML, and stringifying it would leak provider internals.
 *
 * @param {Object} err
 * @returns {string}
 */
const describe = (err) => {
  // A transport failure has no upstream body to quote, and axios's own text is
  // a list of the provider's IPs and ports ("connect ETIMEDOUT
  // 172.64.144.197:443; connect ENETUNREACH ..."). That tells the caller
  // nothing they can act on and hands out someone else's infrastructure
  // details. The wording keeps the words the wallet matches on when it
  // classifies a failure as transient.
  if (err?.request && !err?.response) {
    return 'The upstream provider is unavailable, please try again.';
  }

  const data = err?.response?.data;
  if (!data || typeof data !== 'object') return err.message;

  for (const read of UPSTREAM_MESSAGE_PATHS) {
    const candidate = read(data);
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }

  return err.message;
};

/**
 * Bounded, credential-free log record for an error.
 *
 * NEVER log the raw error object here. An axios error carries `config` and
 * `request`, and `request._header` holds the outgoing request headers verbatim
 * — including provider credentials such as Blockdaemon's `X-API-Key`. Axios
 * only redacts `Authorization`, `Proxy-Authorization` and `Cookie`, so
 * `console.error(err)` published our API key to CloudWatch on every 500, and
 * any unauthenticated caller could trigger one.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {number} status
 * @param {string} error - the snake_case envelope code
 * @returns {Object}
 */
const toLogRecord = (err, req, status, error) => ({
  method: req?.method,
  path: req?.path,
  status,
  error,
  reason: describe(err),
  message: err?.message,
  upstreamStatus: err?.response?.status,
  upstreamUrl: err?.config?.url,
  stack: err?.stack,
});

/**
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
const errorHandler = (err, req, res, next) => {
  const upstreamCode = UPSTREAM_CLIENT_ERRORS[err?.response?.status];
  const status = err?.statusCode ?? (upstreamCode ? err.response.status : 500);
  // `express.json` raises a SyntaxError carrying `statusCode: 400` but no
  // `errorCode`, which produced the contradictory `400 server_error`. Any
  // error that already knows it is a client error gets the generic client
  // code rather than the server one.
  const fallbackCode = status >= 400 && status < 500 ? 'bad_request' : 'server_error';
  const error = err?.errorCode ?? upstreamCode ?? fallbackCode;

  if (status >= 500) {
    console.error('[error-handler]', toLogRecord(err, req, status, error));
  } else {
    console.warn(`${req.method} ${req.path} -> ${status} ${error}: ${describe(err)}`);
  }

  if (res.headersSent) {
    return next(err);
  }

  res.removeHeader('Cache-Control');

  return res.status(status).json({
    error,
    error_description: describe(err),
  });
};

module.exports = errorHandler;
