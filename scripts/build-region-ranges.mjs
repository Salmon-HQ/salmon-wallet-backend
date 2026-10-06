#!/usr/bin/env node
/**
 * Builds src/availability/region-ranges.json: the IP ranges DB-IP places in
 * the Ukrainian regions the availability gate treats separately from the
 * rest of Ukraine (ISO 3166-2 codes). The country database the gate ships
 * (`@ip-location-db/dbip-country-mmdb`) has no region field, and the
 * region-level one is 134 MB, too heavy for the Lambda bundle — so only the
 * few hundred ranges that matter are extracted here.
 *
 * DB-IP files part of Crimea and Sevastopol under RU, not UA, so both
 * countries are read.
 *
 * Usage: node scripts/build-region-ranges.mjs [path/to/dbip-city-lite-YYYY-MM.csv.gz]
 * Without a path it downloads the current month's file from db-ip.com.
 * Data: DB-IP IP to City Lite, CC BY 4.0 (attribution in NOTICE).
 * Rerun when the country database package is bumped, so both stay on the
 * same DB-IP release.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGIONS = {
  'UA-43': ['Crimea'],
  'UA-40': ['Sebastopol City', 'Sevastopol'],
  'UA-14': ['Donetsk', 'Donetsk Oblast'],
  'UA-09': ['Luhansk', 'Luhansk Oblast', 'Lugansk'],
  'UA-65': ['Kherson', 'Kherson Oblast'],
  'UA-23': ['Zaporizhzhia', 'Zaporizhia', 'Zaporizhzhya Oblast', 'Zaporizhzhia Oblast'],
};
const COUNTRIES = new Set(['UA', 'RU']);
const codeOf = new Map(
  Object.entries(REGIONS).flatMap(([code, names]) => names.map((n) => [n.toLowerCase(), code]))
);

const fields = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

const input = async (arg) => {
  if (arg) return fs.createReadStream(arg);
  const month = new Date().toISOString().slice(0, 7);
  const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.csv.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Readable.fromWeb(res.body);
};

const main = async () => {
  const source = process.argv[2];
  const lines = readline.createInterface({
    input: (await input(source)).pipe(zlib.createGunzip()),
  });
  const ranges = [];
  for await (const line of lines) {
    const [start, end, , country, region] = fields(line);
    if (!COUNTRIES.has(country)) continue;
    const code = codeOf.get((region || '').toLowerCase());
    if (code) ranges.push([start, end, code]);
  }

  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/availability/region-ranges.json'
  );
  const release = source
    ? path.basename(source).replace(/\.csv\.gz$/, '')
    : `dbip-city-lite-${new Date().toISOString().slice(0, 7)}`;
  fs.writeFileSync(
    out,
    `${JSON.stringify({ source: `DB-IP IP to City Lite (${release}), CC BY 4.0`, ranges }, null, 0).replace(/\],\[/g, '],\n[')}\n`
  );
  const counts = ranges.reduce((acc, [, , code]) => ({ ...acc, [code]: (acc[code] || 0) + 1 }), {});
  console.log(`wrote ${ranges.length} ranges to ${path.relative(process.cwd(), out)}`, counts);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
