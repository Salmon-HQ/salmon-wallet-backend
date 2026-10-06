'use strict';

/**
 * Verifies 0x's RFC 9421 HTTP Message Signature on a swap response, so a
 * quote that did not come from 0x, or that answers a different order than
 * the one we sent, never reaches the wallet.
 *
 * Port of 0x's reference `verify.ts` (0xProject/0x-examples,
 * swap-signed-responses-example); depends only on `node:crypto`.
 * Docs: https://docs.0x.org/docs/developer-resources/response-signatures
 */

const { createHash, createPublicKey, verify } = require('node:crypto');

/**
 * 0x signing keys by `keyid` (Ed25519 JWK `x`). 0x rotates them: a new key
 * goes in `ZEROEX_SIGNING_KEYS` (JSON `{ "<keyid>": "<x>" }`) without a
 * release, and here on the next one.
 */
const PINNED_KEYS = {
  '0x-signing-key-prod-24092026': '19P3C981JsyQsqwVho8Tlabx51rslvdruSH59mGuWn0',
};

const MAX_AGE_SECONDS = 60;

/** Components every 0x signature must cover; a POST must also cover the request body digest. */
const REQUIRED_COMPONENTS = [
  '@status',
  'content-digest',
  '@method;req',
  '@authority;req',
  '@path;req',
  '@query;req',
];

class SignatureVerificationError extends Error {}

const signingKeys = () => {
  let extra = {};
  if (process.env.ZEROEX_SIGNING_KEYS) {
    try {
      extra = JSON.parse(process.env.ZEROEX_SIGNING_KEYS);
    } catch {
      console.error('[SWAP_MISCONFIGURED] ZEROEX_SIGNING_KEYS is not valid JSON');
    }
  }
  return { ...PINNED_KEYS, ...extra };
};

const contentDigest = (data) => `sha-256=:${createHash('sha256').update(data).digest('base64')}:`;

const parseSignatureInput = (header) => {
  if (!header.startsWith('sig=')) {
    throw new SignatureVerificationError('Signature-Input has no "sig" signature');
  }
  const serializedParams = header.slice('sig='.length);
  const match = serializedParams.match(/^\(([^)]*)\)(.*)$/);
  if (!match) throw new SignatureVerificationError('Signature-Input is malformed');
  const components = [...match[1].matchAll(/"([^"]+)"(;req)?/g)].map((m) => ({
    name: m[1],
    req: m[2] !== undefined,
  }));
  const params = {};
  for (const m of match[2].matchAll(/;([a-z]+)=(?:"([^"]*)"|(\d+))/g)) {
    params[m[1]] = m[2] !== undefined ? m[2] : Number(m[3]);
  }
  return { components, serializedParams, params };
};

const componentValue = ({ name, req }, request, response) => {
  const url = new URL(request.url);
  if (req) {
    switch (name) {
      case '@method':
        return request.method.toUpperCase();
      case '@authority':
        return url.host.toLowerCase();
      case '@path':
        return url.pathname;
      case '@query':
        return url.search === '' ? '?' : url.search;
      default: {
        const value = request.headers[name.toLowerCase()];
        if (value === undefined) {
          throw new SignatureVerificationError(`request has no ${name} header`);
        }
        return String(value).trim();
      }
    }
  }
  if (name === '@status') return String(response.status);
  const value = response.headers[name.toLowerCase()];
  if (value === undefined || value === null) {
    throw new SignatureVerificationError(`response has no ${name} header`);
  }
  return String(value).trim();
};

/**
 * @param {{ method: string, url: string, headers: Object, body?: string }} request - as sent,
 *   headers lower-cased, including the `content-digest` we attached to a POST body.
 * @param {{ status: number, headers: Object, body: string|Buffer }} response - headers
 *   lower-cased, `body` the raw bytes before any JSON parsing.
 * @returns {{ keyId: string, created: number }}
 * @throws {SignatureVerificationError}
 */
const verifySignedResponse = (request, response, { keys = signingKeys(), now } = {}) => {
  const nowSeconds = now ?? Math.floor(Date.now() / 1000);
  const signatureInput = response.headers['signature-input'];
  const signature = response.headers.signature;
  if (!signatureInput || !signature) {
    throw new SignatureVerificationError('response is not signed');
  }
  const parsed = parseSignatureInput(String(signatureInput));

  const keyId = parsed.params.keyid;
  if (typeof keyId !== 'string' || !(keyId in keys)) {
    throw new SignatureVerificationError(`unknown keyid ${String(keyId)}`);
  }
  if (parsed.params.alg !== 'ed25519') {
    throw new SignatureVerificationError(`unexpected alg ${String(parsed.params.alg)}`);
  }

  const { created } = parsed.params;
  if (typeof created !== 'number' || Math.abs(nowSeconds - created) > MAX_AGE_SECONDS) {
    throw new SignatureVerificationError(`signature created at ${String(created)} is not fresh`);
  }

  const covered = parsed.components.map((c) => (c.req ? `${c.name};req` : c.name));
  const required =
    request.body !== undefined
      ? [...REQUIRED_COMPONENTS, 'content-digest;req']
      : REQUIRED_COMPONENTS;
  for (const name of required) {
    if (!covered.includes(name)) {
      throw new SignatureVerificationError(`signature does not cover ${name}`);
    }
  }

  if (response.headers['content-digest'] !== contentDigest(response.body)) {
    throw new SignatureVerificationError('response body does not match Content-Digest');
  }
  if (
    request.body !== undefined &&
    request.headers['content-digest'] !== contentDigest(request.body)
  ) {
    throw new SignatureVerificationError('request body does not match its Content-Digest');
  }

  const lines = parsed.components.map(
    (c) => `"${c.name}"${c.req ? ';req' : ''}: ${componentValue(c, request, response)}`
  );
  lines.push(`"@signature-params": ${parsed.serializedParams}`);
  const signatureBase = Buffer.from(lines.join('\n'));

  const signatureMatch = String(signature).match(/^sig=:([A-Za-z0-9+/]+=*):$/);
  if (!signatureMatch) throw new SignatureVerificationError('Signature is malformed');
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: keys[keyId] },
    format: 'jwk',
  });
  if (!verify(null, signatureBase, publicKey, Buffer.from(signatureMatch[1], 'base64'))) {
    throw new SignatureVerificationError('signature is invalid');
  }
  return { keyId, created };
};

module.exports = {
  verifySignedResponse,
  contentDigest,
  SignatureVerificationError,
  PINNED_KEYS,
  REQUIRED_COMPONENTS,
};
