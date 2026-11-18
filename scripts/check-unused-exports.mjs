#!/usr/bin/env node
/**
 * No export that nothing outside its own file names.
 *
 * knip covers unused files and dependencies (`npm run check:dead-code`), but
 * it cannot follow `const repo = require('./repo'); repo.find()`, the way
 * this codebase calls a module, and reports most exports as unused. This
 * check asks a narrower question it can answer: is the exported name written
 * anywhere else in the repository, tests included? A name written nowhere
 * else cannot be in use, so the export is removed (the function or constant
 * usually stays, private to its file).
 *
 * Usage: node scripts/check-unused-exports.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Entry points: their exports are called by Lambda or by a stage switch, by name.
const ENTRY = [
  /^src\/index\.js$/,
  /^src\/jobs\/handler\.js$/,
  /^src\/analytics\/handler\.js$/,
  /^src\/network-capabilities\/network-capabilities-[a-z]+\.js$/,
];

const tracked = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.yml'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && !file.startsWith('vendor/'));
const text = new Map(tracked.map((file) => [file, readFileSync(file, 'utf8')]));

/** Names a CommonJS module exports: `module.exports = { a, b: c }` and `exports.a = `. */
function exportedNames(source) {
  const names = new Set();
  const block = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/m);
  if (block) {
    for (const entry of block[1].split(/[,\n]/)) {
      const name = entry.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/);
      if (name) names.add(name[1]);
    }
  }
  for (const [, name] of source.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(name);
  }
  return [...names];
}

const unused = [];
for (const [file, source] of text) {
  const isSource =
    /^(src|packages)\/.*\.js$/.test(file) && !/(__tests__|__mocks__|\.spec\.)/.test(file);
  if (!isSource || ENTRY.some((pattern) => pattern.test(file))) continue;
  for (const name of exportedNames(source)) {
    const word = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
    const usedElsewhere = [...text].some(([other, body]) => other !== file && word.test(body));
    if (!usedElsewhere) unused.push(`${file}: ${name}`);
  }
}

for (const line of unused) console.error(line);
if (unused.length) {
  console.error(
    `\n${unused.length} export(s) that no other file names. Remove them from the exports.`
  );
  process.exit(1);
}
