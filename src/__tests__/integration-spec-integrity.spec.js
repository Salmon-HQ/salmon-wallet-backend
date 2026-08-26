'use strict';

/**
 * Guard: integration specs must always point at real code.
 *
 * CI runs `test:unit`, which excludes `*.integration.spec.js` — so those
 * files are never loaded in CI, and a refactor that deletes a module or a
 * method they use leaves the repo broken with CI green (this happened: a
 * pruned controller method was still invoked by an integration spec and only
 * a full local `npm test` could notice). This suite runs INSIDE `test:unit`
 * and fails the build when any integration spec references code that no
 * longer exists — without executing any of its network calls.
 */

const path = require('path');
const {
  findIntegrationSpecs,
  parseLocalRequires,
  collectMemberAccesses,
  checkSpec,
} = require('./helpers/integration-spec-integrity');

const SRC_ROOT = path.join(__dirname, '..');

describe('integration-spec integrity guard', () => {
  describe('parser', () => {
    it('extracts default, destructured, bare and chained relative requires', () => {
      const source = `
        const service = require('../my-service');
        const { redis, quit } = require('../../repositories/data-source');
        const axios = require('axios');
        const dns = require('node:dns/promises');
        require('./side-effect');
        const url = require('../../infrastructure/client').getRpcUrl('mainnet');
      `;
      const { bindings, barePaths, chained } = parseLocalRequires(source);

      expect(bindings).toEqual([
        { binding: 'service', names: null, requestPath: '../my-service' },
        { binding: null, names: ['redis', 'quit'], requestPath: '../../repositories/data-source' },
        { binding: 'url', names: null, requestPath: '../../infrastructure/client' },
      ]);
      expect(barePaths).toEqual(
        expect.arrayContaining(['./side-effect', '../../infrastructure/client'])
      );
      expect(chained).toEqual([
        { requestPath: '../../infrastructure/client', member: 'getRpcUrl' },
      ]);
    });

    it('collects every member accessed on a binding', () => {
      const source = `
        const controller = require('../controller');
        await controller.price(req, res);
        controller.order(req, res);
        expect(controller.order).toBeDefined();
      `;
      expect(collectMemberAccesses(source, 'controller').sort()).toEqual(['order', 'price']);
    });
  });

  describe('checkSpec', () => {
    const FIXTURE_MODULE = { order: () => {}, execute: () => {} };
    const fixtureLoader = () => FIXTURE_MODULE;
    const fixtureResolver = (absolutePath) => {
      if (absolutePath.includes('this-module-was-deleted')) {
        throw new Error('Cannot find module');
      }
      return absolutePath;
    };
    const fixtureSeams = { loadModule: fixtureLoader, resolveModule: fixtureResolver };
    const specPath = path.join(__dirname, 'fake.integration.spec.js');

    it('regression: reports a member call on a pruned controller method', () => {
      // Mirrors the real incident: the /ft/price endpoints were pruned,
      // controller.price was deleted, and an integration spec kept calling it.
      const source = `
        const controller = require('../solana-ft-controller');
        it('prices', async () => { await controller.price(req, res); });
        it('orders', async () => { await controller.order(req, res); });
      `;
      const problems = checkSpec(specPath, { source, ...fixtureSeams });

      expect(problems).toEqual([expect.stringContaining('`controller.price` does not exist')]);
    });

    it('reports destructured exports that no longer exist', () => {
      const source = `const { order, gone } = require('../solana-ft-controller');`;
      const problems = checkSpec(specPath, { source, ...fixtureSeams });

      expect(problems).toEqual([expect.stringContaining('`gone` does not exist')]);
    });

    it('reports modules that no longer resolve', () => {
      const source = `const x = require('./this-module-was-deleted');`;
      const problems = checkSpec(specPath, { source, ...fixtureSeams });

      expect(problems).toEqual([expect.stringContaining('does not resolve')]);
    });

    it('is silent for a sound spec', () => {
      const source = `
        const controller = require('../solana-ft-controller');
        const { execute } = require('../solana-ft-controller');
        it('works', () => controller.order());
      `;
      expect(checkSpec(specPath, { source, ...fixtureSeams })).toEqual([]);
    });
  });

  describe('repository sweep', () => {
    const specs = findIntegrationSpecs(SRC_ROOT);

    it('finds the integration suite (guards the guard: an empty list means the walker broke)', () => {
      expect(specs.length).toBeGreaterThanOrEqual(1);
    });

    it.each(specs.map((s) => [path.relative(SRC_ROOT, s), s]))(
      '%s references only code that exists',
      (_label, specPath) => {
        expect(checkSpec(specPath)).toEqual([]);
      }
    );
  });
});
