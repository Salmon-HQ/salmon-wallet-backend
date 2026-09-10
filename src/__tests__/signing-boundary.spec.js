'use strict';

/**
 * Signing boundary (AGENTS.md "Signing boundary").
 *
 * The backend never receives a private key, a seed phrase or a signed
 * transaction, and never broadcasts on a user's behalf. Two static checks
 * turn that sentence into a failing test:
 *
 *   1. every non-GET route declared under `src/routes/**` (or on the app in
 *      `src/index.js`) must be listed in MUTATING_ROUTE_ALLOWLIST with a
 *      reason — the only routes allowed to mutate are the ones that BUILD an
 *      unsigned transaction and return it;
 *   2. no controller source may mention a signed-transaction field name.
 *
 * Source scanning is deliberate: it needs no app boot, and every route in
 * this repo is declared as `router.<method>('<path>', ...)`.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

/** Non-GET routes that may exist, each with the reason it is safe. */
const MUTATING_ROUTE_ALLOWLIST = [
  {
    file: 'routes/solana/solana-nft-router.js',
    method: 'post',
    path: '/:mintAddress',
    reason: 'builds an UNSIGNED burn transaction and returns it; never receives signed bytes',
  },
  {
    file: 'routes/solana/solana-nft-router.js',
    method: 'post',
    path: '/:mintAddress/transfer',
    reason: 'builds an UNSIGNED transfer transaction and returns it; never receives signed bytes',
  },
];

/** Request-body field names no controller may read. */
const SIGNED_TX_FIELDS = ['signedTransaction', 'signedTx', 'rawTx', 'serializedTransaction'];

const MUTATING_METHODS = ['post', 'put', 'patch', 'delete'];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
};

const relative = (file) => path.relative(SRC, file);

const declaredMutatingRoutes = () => {
  const files = [...walk(path.join(SRC, 'routes')), path.join(SRC, 'index.js')];
  const pattern = /\b(?:router|app)\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g;
  const found = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      found.push({ file: relative(file), method: match[1], path: match[3] });
    }
  }
  return found;
};

describe('signing boundary', () => {
  test('every non-GET route is in the allowlist with a reason', () => {
    const key = ({ file, method, path: p }) => `${method.toUpperCase()} ${p} (${file})`;
    const allowed = new Set(MUTATING_ROUTE_ALLOWLIST.map(key));
    const declared = declaredMutatingRoutes();

    const violations = declared.filter((route) => !allowed.has(key(route)));
    // Non-GET routes must build unsigned transactions only. Add the route to
    // MUTATING_ROUTE_ALLOWLIST with a reason, or make it a GET.
    expect(violations.map(key)).toEqual([]);

    // The allowlist must not go stale either.
    const stale = [...allowed].filter((entry) => !declared.some((r) => key(r) === entry));
    expect(stale).toEqual([]);

    for (const entry of MUTATING_ROUTE_ALLOWLIST) {
      expect(MUTATING_METHODS).toContain(entry.method);
      expect(entry.reason).toMatch(/UNSIGNED/);
    }
  });

  test('no controller mentions a signed-transaction field', () => {
    const offenders = [];
    for (const file of walk(path.join(SRC, 'controllers'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const field of SIGNED_TX_FIELDS) {
        if (new RegExp(`\\b${field}\\b`).test(source)) {
          offenders.push(`${relative(file)}: ${field}`);
        }
      }
    }
    // Controllers must never read a signed transaction; the client signs and
    // broadcasts on the device.
    expect(offenders).toEqual([]);
  });
});
