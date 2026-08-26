'use strict';

/**
 * Usage-analytics ingest handler.
 *
 * A raw, dependency-light Lambda handler (deliberately NOT mounted in the main
 * Express app) so it runs as an isolated function and a traffic spike can't
 * starve the wallet API's concurrency.
 *
 * Privacy posture:
 * - The client IP is never read or stored. We do not touch
 *   `requestContext.identity.sourceIp` or `X-Forwarded-For`.
 * - Every event is re-validated against the shared allow-list; anything that
 *   looks like an address, mint, raw number, or oversized string is dropped.
 */

const { applyConnectTuning } = require('../infrastructure/connect-tuning');
const { safeValidateEvent } = require('./event-schema');
const { createSink } = require('./sink');

// Raise Node's 250ms per-address connect budget before any provider is
// dialed; see `infrastructure/connect-tuning` for why the default turns a
// slow handshake into a hard failure.
applyConnectTuning();

const PLATFORMS = new Set(['web', 'extension', 'mobile']);
const MAX_EVENTS_PER_BATCH = 100;
const MAX_ID_LENGTH = 64;
const MAX_VERSION_LENGTH = 32;

// One sink per warm container.
let sink = null;
function getSink() {
  if (!sink) sink = createSink();
  return sink;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/** Trims and length-caps a context string, returning '' for anything invalid. */
function safeString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

// Every client derives its version from its own package.json/app.json, so a
// well-behaved one always sends plain semver. Truncating whatever arrives to 32
// chars let arbitrary strings through and made the GA4 dimension unusable.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Returns the version only when it is semver-shaped and sane-length, '' otherwise. */
function safeVersion(value) {
  // Reject overlong values instead of truncating: a sliced prerelease could
  // still match the regex and record a corrupted version, and '' beats wrong.
  if (typeof value !== 'string' || value.length > MAX_VERSION_LENGTH) return '';
  return SEMVER.test(value) ? value : '';
}

/** Extracts a safe, identity-less context from the batch. */
function sanitizeContext(raw) {
  const context = raw && typeof raw === 'object' ? raw : {};
  const platform = PLATFORMS.has(context.platform) ? context.platform : 'unknown';
  return {
    install_id: safeString(context.installId, MAX_ID_LENGTH),
    session_id: safeString(context.sessionId, MAX_ID_LENGTH),
    platform,
    app_version: safeVersion(context.appVersion),
  };
}

function methodOf(event) {
  return (
    event.httpMethod ||
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    ''
  );
}

function parseBody(event) {
  if (!event.body) return null;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(raw);
}

exports.handler = async (event) => {
  const method = methodOf(event).toUpperCase();
  if (method === 'OPTIONS') return respond(204, {});
  if (method !== 'POST') {
    return respond(405, {
      error: 'method_not_allowed',
      error_description: 'This endpoint only accepts POST.',
    });
  }

  let payload;
  try {
    payload = parseBody(event);
  } catch {
    return respond(400, {
      error: 'invalid_json',
      error_description: 'The request body is not valid JSON.',
    });
  }

  if (!payload || !Array.isArray(payload.events)) {
    return respond(400, {
      error: 'events_array_required',
      error_description: 'The request body must carry an `events` array.',
    });
  }

  const context = sanitizeContext(payload.context);
  const receivedAt = Date.now();
  const dt = new Date(receivedAt).toISOString().slice(0, 10);

  const records = [];
  // Events past the batch cap are dropped. Counting them as rejected keeps the
  // response honest: a client that sent 150 events used to be told 100 were
  // accepted and 0 rejected, so the 50 lost ones were invisible on both sides.
  let rejected = Math.max(payload.events.length - MAX_EVENTS_PER_BATCH, 0);
  for (const raw of payload.events.slice(0, MAX_EVENTS_PER_BATCH)) {
    const validated =
      raw && typeof raw === 'object' ? safeValidateEvent(raw.event, raw.props) : null;
    if (!validated) {
      rejected += 1;
      continue;
    }
    records.push({
      event: validated.event,
      props: validated.props,
      ts: typeof raw.ts === 'number' ? raw.ts : receivedAt,
      received_at: receivedAt,
      dt,
      ...context,
    });
  }

  // Nothing usable came through — signal a bad request (likely tamper/drift).
  if (records.length === 0) {
    return respond(400, {
      error: 'no_valid_events',
      error_description: 'No event in the batch passed validation.',
      rejected,
    });
  }

  try {
    await getSink().putRecords(records);
  } catch (error) {
    // Best-effort delivery: acknowledge so the client doesn't retry-storm, but
    // do not surface sink internals. Log it, though — a misconfigured GA4 sink
    // throws on every call, and swallowing that silently means analytics can
    // be dead for weeks with nothing anywhere to show it.
    console.warn(`[analytics] sink delivery failed: ${error.message}`);
    return respond(202, { accepted: 0, rejected, buffered: false });
  }

  return respond(202, { accepted: records.length, rejected });
};
