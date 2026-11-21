const js = require('@eslint/js');
const regexp = require('eslint-plugin-regexp');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // Node.js globals
        global: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        // Jest globals
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-prototype-builtins': 'off',
    },
  },
  {
    // Patterns that backtrack or rescan in more than linear time. Most text
    // this API matches is written by a caller, a minter or a remote page, so
    // it holds for everything that ships; specs and scripts match files of
    // this repository and are left out.
    files: ['src/**/*.js', 'packages/**/*.js'],
    ignores: ['**/__tests__/**'],
    plugins: { regexp },
    rules: {
      'regexp/no-super-linear-backtracking': 'error',
      'regexp/no-super-linear-move': 'error',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      '.serverless/**',
      'coverage/**',
      'dist/**',
      'build/**',
    ],
  },
];
