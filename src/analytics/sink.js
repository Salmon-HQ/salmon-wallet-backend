'use strict';

/**
 * Pluggable event sink, selected by `ANALYTICS_SINK`:
 *
 * - `file` (default): append NDJSON to `ANALYTICS_FILE_PATH`. Zero external
 *   dependency — used for local Docker runs and tests.
 * - `ga4`: forward each record to Google Analytics 4 via the Measurement
 *   Protocol (`GA4_MEASUREMENT_ID` + `GA4_API_SECRET`). Used in production.
 *
 * Why proxy GA4 server-side instead of a client SDK:
 * - Anonymity: GA4 attributes an event to the IP of whoever calls
 *   `/mp/collect`. That caller is this Lambda, so Google only ever sees the
 *   server IP — the user's IP never leaves the backend. We deliberately do NOT
 *   send `ip_override`, which would defeat this.
 * - Secret hygiene: the Measurement Protocol `api_secret` stays a server-side
 *   env var and is never shipped in the (open-source) client or committed.
 *
 * A sink exposes `putRecords(records)` where `records` is an array of plain
 * objects. Implementations must never throw into the caller in a way that leaks
 * — the handler treats delivery as best-effort.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_FILE_PATH = './.analytics-local/events.ndjson';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
// Measurement Protocol accepts at most 25 events per request.
const GA4_MAX_EVENTS_PER_REQUEST = 25;
const GA4_REQUEST_TIMEOUT = 5000;

function createFileSink() {
  const filePath = process.env.ANALYTICS_FILE_PATH || DEFAULT_FILE_PATH;
  return {
    type: 'file',
    async putRecords(records) {
      if (!records.length) return;
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      await fs.promises.appendFile(filePath, lines, 'utf8');
    },
  };
}

/**
 * Maps one validated record to a Measurement Protocol event. The record's
 * allow-listed props (`chain`, `success`, `amount_bucket`, …) become event
 * params alongside the context. `platform` is what lets a single GA4 property
 * tell mobile, web and extension apart — register it (and each prop) as a
 * custom dimension in the GA4 console or it will not surface in reports.
 */
function toGa4Event(record) {
  return {
    name: record.event,
    params: {
      session_id: record.session_id,
      // Marks the event as engaged so GA4 counts it; we do not measure real
      // engagement time. Omitting this hides events from some default reports.
      engagement_time_msec: 1,
      platform: record.platform,
      app_version: record.app_version,
      ...record.props,
    },
  };
}

function createGa4Sink() {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    throw new Error('GA4_MEASUREMENT_ID and GA4_API_SECRET are required when ANALYTICS_SINK=ga4');
  }
  const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  return {
    type: 'ga4',
    async putRecords(records) {
      if (!records.length) return;
      // The handler builds a batch from a single client context, so every
      // record here shares one install — one client_id per request. `install_id`
      // is a random, PII-free per-install token (the "stable id" that lets GA4
      // build funnels). A batch with no id is degenerate; fall back to a random
      // one so the Measurement Protocol call still has a non-empty client_id.
      const clientId = records[0].install_id || randomUUID();

      for (let i = 0; i < records.length; i += GA4_MAX_EVENTS_PER_REQUEST) {
        const chunk = records.slice(i, i + GA4_MAX_EVENTS_PER_REQUEST);
        const body = { client_id: clientId, events: chunk.map(toGa4Event) };
        const res = await fetch(url, {
          method: 'POST',
          body: JSON.stringify(body),
          // Without this the call inherits no deadline and a hung Google
          // endpoint burns the whole Lambda timeout, after which the client
          // retries the same batch.
          signal: AbortSignal.timeout(GA4_REQUEST_TIMEOUT),
        });
        // Measurement Protocol always answers 2xx for a well-formed request and
        // never validates event contents synchronously, so a non-2xx here is a
        // transport failure. Throw it into the handler's best-effort catch.
        if (!res.ok) {
          throw new Error(`GA4 Measurement Protocol returned ${res.status}`);
        }
      }
    },
  };
}

/** Builds the configured sink. Defaults to the file sink. */
function createSink() {
  const kind = (process.env.ANALYTICS_SINK || 'file').toLowerCase();
  return kind === 'ga4' ? createGa4Sink() : createFileSink();
}

module.exports = { createSink, createFileSink, createGa4Sink, toGa4Event };
