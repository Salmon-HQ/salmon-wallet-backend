#!/usr/bin/env node
/**
 * Downloads this month's DB-IP "IP to Country Lite" database into
 * src/availability/data/dbip-country-lite.mmdb and rebuilds
 * src/availability/region-ranges.json from the same month's City Lite, so the
 * availability gate always ships one DB-IP release. Every production deploy
 * runs it (.github/workflows/deploy.yml): on prod the gate stops placing
 * anyone once the database is older than 45 days, which switches Swap off.
 *
 * DB-IP publishes on the 1st; early that day the new month is not out yet, so
 * the previous month is used. Any failure exits non-zero and fails the deploy:
 * a deploy must never ship a database it could not check.
 *
 * Usage: node scripts/refresh-geo-data.mjs
 * Data: DB-IP Lite, CC BY 4.0 (attribution in NOTICE).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Reader } = require('mmdb-lib');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'src/availability/data');
const DATABASE = path.join(DATA_DIR, 'dbip-country-lite.mmdb');
const RANGES = path.join(ROOT, 'src/availability/region-ranges.json');
const MAX_AGE_DAYS = 40;
// Every region the gate treats on its own; a renamed one would fall back to UA, where Swap is open.
const REGIONS = ['UA-43', 'UA-40', 'UA-14', 'UA-09', 'UA-65', 'UA-23'];
const FETCH_TIMEOUT_MS = 120_000;

const monthOf = (date) => date.toISOString().slice(0, 7);
const lastMonth = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));

const download = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
};

/** Throws unless `buffer` is a DB-IP country database, recent, that places known addresses. */
const verifyCountryDatabase = (buffer, now = new Date()) => {
  const reader = new Reader(buffer);
  const { databaseType, buildEpoch } = reader.metadata;
  if (!/country/i.test(databaseType)) throw new Error(`unexpected database type ${databaseType}`);
  const ageDays = (now - buildEpoch) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS) throw new Error(`database built ${buildEpoch.toISOString()}`);
  const code = (ip) => reader.get(ip)?.country?.iso_code;
  // DB-IP publishes no checksum for the free files: long-stable addresses in
  // the US and in blocked countries are the check that the data was not altered.
  for (const [ip, country] of [
    ['8.8.8.8', 'US'],
    ['81.2.69.142', 'GB'],
    ['212.58.244.20', 'GB'],
    ['2.144.0.1', 'IR'],
    ['152.206.0.1', 'CU'],
    ['114.114.114.114', 'CN'],
  ]) {
    if (code(ip) !== country) throw new Error(`${ip} is not placed in ${country}`);
  }
  if (!/^[A-Z]{2}$/.test(code('2001:4860:4860::8888') ?? '')) throw new Error('IPv6 is not placed');
  return buildEpoch;
};

const main = async () => {
  const now = new Date();
  let month;
  let gz;
  for (const candidate of [monthOf(now), monthOf(lastMonth(now))]) {
    gz = await download(`https://download.db-ip.com/free/dbip-country-lite-${candidate}.mmdb.gz`);
    if (gz) {
      month = candidate;
      break;
    }
  }
  if (!gz) throw new Error('no DB-IP country database for this month or the last');

  const database = zlib.gunzipSync(gz);
  const builtAt = verifyCountryDatabase(database, now);

  const cityUrl = `https://download.db-ip.com/free/dbip-city-lite-${month}.csv.gz`;
  const city = await download(cityUrl);
  if (!city) throw new Error(`${cityUrl}: not available`);
  const cityFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'dbip-')),
    `dbip-city-lite-${month}.csv.gz`
  );
  fs.writeFileSync(cityFile, city);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-region-ranges.mjs'), cityFile], {
    stdio: 'inherit',
  });
  const found = new Set(
    JSON.parse(fs.readFileSync(RANGES, 'utf8')).ranges.map(([, , code]) => code)
  );
  const missing = REGIONS.filter((code) => !found.has(code));
  if (missing.length) throw new Error(`region ranges lack ${missing.join(', ')}`);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${DATABASE}.tmp`, database);
  fs.renameSync(`${DATABASE}.tmp`, DATABASE);
  console.log(
    `DB-IP ${month}: country database built ${builtAt.toISOString()}, region ranges rebuilt`
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`refresh-geo-data: ${error.message}`);
    process.exit(1);
  });
}
