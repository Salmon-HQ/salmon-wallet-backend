'use strict';

const resolveClientIp = (req) => {
  if (req.ips?.length > 0) {
    return req.ips[0];
  }
  if (req.connection?.remoteAddress) {
    const ips = req.connection.remoteAddress.split(',');
    if (ips.length > 0) {
      return ips[0].trim();
    }
  }
  return undefined;
};

/**
 * The address the request really came from, for anything that must not be
 * spoofable (rate limiting, country resolution). Order:
 *   1. API Gateway's `requestContext.identity.sourceIp` (attached to the
 *      Express request by serverless-http) — the caller cannot set it.
 *   2. The LAST entry of `X-Forwarded-For` — API Gateway appends the real
 *      client address at the end; earlier entries are client-controlled.
 *   3. `req.socket.remoteAddress` — direct connections (local dev).
 *
 * `resolveClientIp` above is the logging-friendly variant (Express `req.ips`
 * first); this one is the authoritative variant.
 *
 * @param {object} req - Express request.
 * @returns {string|undefined} The source address, or undefined when unknown.
 */
const resolveSourceIp = (req) => {
  const sourceIp = req.requestContext?.identity?.sourceIp;
  if (sourceIp) return sourceIp;

  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length) return entries[entries.length - 1];
  }

  return req.socket?.remoteAddress || undefined;
};

module.exports = {
  resolveClientIp,
  resolveSourceIp,
};
