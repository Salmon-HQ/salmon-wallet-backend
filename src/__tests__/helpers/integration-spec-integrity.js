'use strict';

/**
 * Static + load-time integrity checks for `*.integration.spec.js` files.
 *
 * CI's `verify` job runs `test:unit`, which excludes integration specs, so
 * they are never even loaded in CI. This helper lets a UNIT spec verify that
 * every integration spec still points at real code — modules that resolve,
 * destructured exports that exist, and member accesses (`service.method`)
 * that are actually exported — without executing any network call.
 *
 * It intentionally checks only RELATIVE requires (repo code). Node built-ins
 * and npm packages are out of scope: they do not rot when we refactor.
 */

const fs = require('fs');
const path = require('path');

/**
 * Recursively find every `*.integration.spec.js` under `rootDir`.
 * @param {string} rootDir
 * @returns {string[]} absolute paths
 */
const findIntegrationSpecs = (rootDir) => {
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.integration.spec.js')) {
        results.push(full);
      }
    }
  };
  walk(rootDir);
  return results;
};

const REQUIRE_BINDING_RE =
  /(?:const|let|var)\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const REQUIRE_BARE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const REQUIRE_CHAINED_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)\.([A-Za-z_$][\w$]*)/g;

/**
 * Parse the relative `require`s of a spec source.
 * @param {string} source
 * @returns {{bindings: Array<{binding: string|null, names: string[]|null, requestPath: string}>, barePaths: string[], chained: Array<{requestPath: string, member: string}>}}
 */
const parseLocalRequires = (source) => {
  const bindings = [];
  const chained = [];
  const barePaths = [];

  let match;
  while ((match = REQUIRE_BINDING_RE.exec(source)) !== null) {
    const [, destructured, binding, requestPath] = match;
    bindings.push({
      binding: binding || null,
      names: destructured
        ? destructured
            .split(',')
            .map((n) => n.split(':')[0].trim())
            .filter(Boolean)
        : null,
      requestPath,
    });
  }
  while ((match = REQUIRE_CHAINED_RE.exec(source)) !== null) {
    chained.push({ requestPath: match[1], member: match[2] });
  }
  while ((match = REQUIRE_BARE_RE.exec(source)) !== null) {
    barePaths.push(match[1]);
  }

  return { bindings, barePaths, chained };
};

/**
 * Collect every property accessed on `binding` in the source (`binding.prop`).
 * @param {string} source
 * @param {string} binding
 * @returns {string[]} unique property names
 */
const collectMemberAccesses = (source, binding) => {
  const re = new RegExp(`\\b${binding}\\.([A-Za-z_$][\\w$]*)`, 'g');
  const props = new Set();
  let match;
  while ((match = re.exec(source)) !== null) {
    props.add(match[1]);
  }
  return [...props];
};

/**
 * Check one integration spec: every relative require resolves, every
 * destructured name exists, every accessed member exists on the export.
 *
 * @param {string} specPath - absolute path to the integration spec
 * @param {{source?: string, loadModule?: (resolved: string) => any, resolveModule?: (absolutePath: string) => string}} [overrides] -
 *   test seams: `source` replaces the file read, `loadModule` replaces
 *   `require`, `resolveModule` replaces `require.resolve` (both default to
 *   the real ones).
 * @returns {string[]} human-readable problems; empty when the spec is sound.
 */
const checkSpec = (specPath, overrides = {}) => {
  const problems = [];
  const source = overrides.source ?? fs.readFileSync(specPath, 'utf8');
  const loadModule = overrides.loadModule ?? ((resolved) => require(resolved));
  const resolveModule =
    overrides.resolveModule ?? ((absolutePath) => require.resolve(absolutePath));
  const specDir = path.dirname(specPath);

  const { bindings, barePaths, chained } = parseLocalRequires(source);

  const resolveOrReport = (requestPath) => {
    try {
      return resolveModule(path.join(specDir, requestPath));
    } catch {
      problems.push(`${requestPath}: module does not resolve`);
      return null;
    }
  };

  for (const requestPath of barePaths) {
    resolveOrReport(requestPath);
  }

  const loadOrReport = (requestPath) => {
    const resolved = resolveModule(path.join(specDir, requestPath));
    try {
      return loadModule(resolved);
    } catch (error) {
      problems.push(`${requestPath}: module fails to load (${error.message})`);
      return null;
    }
  };

  for (const { binding, names, requestPath } of bindings) {
    if (resolveOrReport(requestPath) === null) continue;
    const mod = loadOrReport(requestPath);
    if (mod === null) continue;

    if (names) {
      for (const name of names) {
        if (!(name in mod)) {
          problems.push(`${requestPath}: destructured export \`${name}\` does not exist`);
        }
      }
    }
    if (binding) {
      for (const prop of collectMemberAccesses(source, binding)) {
        if (!(prop in Object(mod))) {
          problems.push(
            `${requestPath}: \`${binding}.${prop}\` does not exist on the module's exports`
          );
        }
      }
    }
  }

  for (const { requestPath, member } of chained) {
    if (resolveOrReport(requestPath) === null) continue;
    const mod = loadOrReport(requestPath);
    if (mod !== null && !(member in Object(mod))) {
      problems.push(
        `${requestPath}: \`require(...).${member}\` does not exist on the module's exports`
      );
    }
  }

  // A require can match more than one pattern (binding + bare); report once.
  return [...new Set(problems)];
};

module.exports = { findIntegrationSpecs, parseLocalRequires, collectMemberAccesses, checkSpec };
