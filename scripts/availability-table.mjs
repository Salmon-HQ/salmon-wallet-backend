#!/usr/bin/env node
/**
 * Edits the availability table in SSM (`/salmon-api/<stage>/AVAILABILITY_TABLE`)
 * through the same `validateTable` the backend runs on load. An invalid
 * document is refused here, because the backend would silently keep serving
 * the previous table instead.
 *
 * Usage:
 *   node scripts/availability-table.mjs                          # print the live table
 *   node scripts/availability-table.mjs --unavailable +GB        # dry-run: validate and diff
 *   node scripts/availability-table.mjs --unavailable -GB --execute
 *   node scripts/availability-table.mjs --file table.json [--execute]
 * Options: --capability <name> (default swap), --stage <stage> (default prod).
 * Dry-run is the default; --execute writes, then reads the parameter back.
 * Uses the AWS CLI with the caller's credentials, like ssm-put-params.sh.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { validateTable } = createRequire(import.meta.url)(
  '../src/availability/availability-table.js'
);

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const stage = opt('--stage', 'prod');
const capability = opt('--capability', 'swap');
const unavailable = opt('--unavailable');
const file = opt('--file');
const execute = args.includes('--execute');
const name = `/salmon-api/${stage}/AVAILABILITY_TABLE`;

const aws = (...a) => execFileSync('aws', ['ssm', ...a, '--output', 'json'], { encoding: 'utf8' });
const read = () => JSON.parse(aws('get-parameter', '--name', name)).Parameter;
const pretty = (doc) => JSON.stringify(doc, null, 2).split('\n');

const live = read();
const current = JSON.parse(live.Value);
console.log(`${name} version ${live.Version}`);

let next;
if (file) {
  next = JSON.parse(fs.readFileSync(file, 'utf8'));
} else if (unavailable) {
  const [sign, code] = [unavailable[0], unavailable.slice(1)];
  if (!['+', '-'].includes(sign) || !code) throw new Error('--unavailable takes +CC or -CC');
  next = JSON.parse(live.Value);
  const row = next.capabilities?.[capability];
  if (!row) throw new Error(`no capability "${capability}" in the table`);
  const list = new Set(row.unavailable ?? []);
  sign === '+' ? list.add(code) : list.delete(code);
  row.unavailable = [...list];
} else {
  console.log(pretty(current).join('\n'));
  process.exit(0);
}

const problems = validateTable(next);
if (problems.length) {
  console.error(`Refused, the backend would reject this table:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const before = pretty(current);
const after = pretty(next);
// ponytail: set difference of lines, blind to moved or repeated lines; fine for country lists, swap for a real diff if edits get structural.
const diff = [
  ...before.filter((l) => !after.includes(l)).map((l) => `- ${l}`),
  ...after.filter((l) => !before.includes(l)).map((l) => `+ ${l}`),
];
if (!diff.length) {
  console.log('No change.');
  process.exit(0);
}
console.log(diff.join('\n'));

if (!execute) {
  console.log('Dry-run. Re-run with --execute to write.');
  process.exit(0);
}
aws(
  'put-parameter',
  '--name',
  name,
  '--type',
  'String',
  '--overwrite',
  '--value',
  JSON.stringify(next)
);
const written = read();
if (written.Value !== JSON.stringify(next))
  throw new Error('read-back does not match what was written');
console.log(`Written: version ${written.Version}. The backend picks it up within 5 minutes.`);
