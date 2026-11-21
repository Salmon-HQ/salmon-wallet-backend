#!/usr/bin/env node
/**
 * Duplicated lines only go down.
 *
 * Measures copy-pasted blocks in the source (tests left out) with jscpd and
 * compares the total with the ceiling below. Above it, the change added a
 * copy: share the code. Below it, lower the ceiling to the printed number in
 * the same change, so the next copy fails here.
 *
 * Most of what is counted today is the per-stage capability files under
 * `src/network-capabilities/`, which repeat each other by design.
 *
 * Usage: node scripts/check-duplication.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DUPLICATED_LINES_MAX = 362;

const out = mkdtempSync(path.join(tmpdir(), 'jscpd-'));
try {
  execFileSync(
    'npx',
    [
      'jscpd',
      'src',
      'packages',
      'scripts',
      '--min-lines',
      '5',
      '--min-tokens',
      '50',
      '--format',
      'javascript',
      '--ignore',
      '**/node_modules/**,**/coverage/**,**/*.spec.js,**/__tests__/**,**/__mocks__/**',
      '--reporters',
      'json',
      '--output',
      out,
      '--silent',
    ],
    { stdio: 'ignore' }
  );
  const report = JSON.parse(readFileSync(path.join(out, 'jscpd-report.json'), 'utf8'));
  const measured = report.statistics.total.duplicatedLines;

  if (measured > DUPLICATED_LINES_MAX) {
    for (const clone of report.duplicates) {
      const { firstFile: a, secondFile: b } = clone;
      console.error(`${clone.lines} lines  ${a.name}:${a.start}  |  ${b.name}:${b.start}`);
    }
    console.error(
      `\nduplication: ${measured} duplicated lines, ceiling ${DUPLICATED_LINES_MAX}. Share the code instead of copying it.`
    );
    process.exit(1);
  }
  if (measured < DUPLICATED_LINES_MAX) {
    console.error(
      `duplication: ${measured} duplicated lines, under the ceiling of ${DUPLICATED_LINES_MAX}. Lower DUPLICATED_LINES_MAX to ${measured} in scripts/check-duplication.mjs.`
    );
    process.exit(1);
  }
  console.log(`duplication: ${measured} duplicated lines, at the ceiling`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
