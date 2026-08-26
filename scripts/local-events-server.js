'use strict';

/**
 * Local dev HTTP runner for the usage-analytics ingest handler.
 *
 * NOT deployed and NOT wired into serverless.yml. It wraps the real
 * `src/analytics/handler` over a plain HTTP server so the pipeline
 * (validate → guardrail → file sink → NDJSON) can be exercised locally —
 * with curl or the Playwright suite — WITHOUT the full serverless-offline
 * stack (which needs the private @4m packages) and WITHOUT touching AWS.
 *
 * The sink defaults to the file sink, so nothing leaves the machine.
 *
 * Usage:
 *   ANALYTICS_SINK=file ANALYTICS_FILE_PATH=./.analytics-local/events.ndjson \
 *   PORT=4319 node scripts/local-events-server.js
 */

const http = require('http');
const { handler } = require('../src/analytics/handler');

const PORT = Number(process.env.PORT || 4319);

function toApiGatewayEvent(req, body) {
  return {
    httpMethod: req.method,
    path: req.url,
    headers: req.headers,
    body: body.length ? body : null,
    isBase64Encoded: false,
    requestContext: { identity: { sourceIp: req.socket.remoteAddress } },
  };
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const result = await handler(toApiGatewayEvent(req, body));
      res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json' });
      res.end(result.body || '');
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'handler_error' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(
    `[local-events-server] :${PORT} sink=${process.env.ANALYTICS_SINK || 'file'} -> ${process.env.ANALYTICS_FILE_PATH || './.analytics-local/events.ndjson'}`
  );
});
