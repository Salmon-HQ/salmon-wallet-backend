'use strict';

/**
 * Repository-layer facade over the shared cache primitives, which live in
 * `src/infrastructure/cache/cache-helper.js`. Repositories keep importing
 * from here; the infrastructure cache layer imports the primitives
 * directly so it never depends on `src/repositories`.
 */

module.exports = require('../infrastructure/cache/cache-helper');
