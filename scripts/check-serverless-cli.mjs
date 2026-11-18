#!/usr/bin/env node
/**
 * The Serverless CLI that runs is the one that was reviewed.
 *
 * Serverless Framework v4 is not in the lockfile: the npm package downloads an
 * installer, and the installer downloads the release named by
 * `frameworkVersion`. Serverless, Inc. publishes no checksum for either, so
 * this script holds ours. It runs before a deploy takes AWS credentials and
 * again after it, and fails when the installer or the release differs from
 * the fingerprints below, or when any other release is present.
 *
 * Moving to another version: change `serverless` in package.json and
 * `frameworkVersion` in serverless.yml, run `npx serverless --version` and
 * `node scripts/check-serverless-cli.mjs --print` on each platform listed in
 * PINNED, and replace the fingerprints with what it prints.
 *
 * Usage: node scripts/check-serverless-cli.mjs [--print]
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PINNED = {
  'darwin-arm64': {
    installer: '6f79e431692b3358f5ae6e8a183ed3e3c32633107c603efa68be96bb3f402099',
    release: 'ae8fb1f29b104f17cf7a8b8f0402fd46e02bb550031be98aa570a1dcb1dfb2fd',
  },
  'linux-x64': {
    installer: '81f33db1c134d629e4253df6c4a9b710d6df9b90baef0bc34dfeb3f5eb07d35f',
    release: '185f881895d3e12b6b56a68140f7016eee714aa682f78e195900cb8b5d702da9',
  },
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// One fingerprint for a folder: every file's path and content, in name order.
function treeHash(root) {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = lstatSync(full);
      const relative = path.relative(root, full);
      if (stat.isSymbolicLink()) hash.update(`${relative}\0link\0${readlinkSync(full)}\n`);
      else if (stat.isDirectory()) walk(full);
      else hash.update(`${relative}\0${sha256(readFileSync(full))}\n`);
    }
  };
  walk(root);
  return hash.digest('hex');
}

const fail = (message) => {
  console.error(`serverless-cli: ${message}`);
  process.exit(1);
};

const version = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.serverless;
if (!readFileSync('serverless.yml', 'utf8').includes(`\nframeworkVersion: '${version}'\n`)) {
  fail(
    `package.json pins serverless ${version}; frameworkVersion in serverless.yml must name the same version.`
  );
}

const installerDir = 'node_modules/serverless/node_modules/.bin';
const installers = existsSync(installerDir) ? readdirSync(installerDir) : [];
const releasesDir = path.join(os.homedir(), '.serverless', 'releases');
const releases = existsSync(releasesDir) ? readdirSync(releasesDir) : [];
if (installers.length !== 1 || !releases.includes(version)) {
  fail(`the CLI is not downloaded yet. Run \`npx serverless --version\` first.`);
}

const measured = {
  installer: sha256(readFileSync(path.join(installerDir, installers[0]))),
  release: treeHash(path.join(releasesDir, version)),
};
const platform = `${process.platform}-${process.arch}`;

if (process.argv.includes('--print')) {
  console.log(`'${platform}': ${JSON.stringify(measured)}`);
  process.exit(0);
}

const pinned = PINNED[platform];
if (!pinned)
  fail(`no fingerprint for ${platform}; deploys run from ${Object.keys(PINNED).join(' or ')}.`);
for (const part of ['installer', 'release']) {
  if (measured[part] !== pinned[part]) {
    fail(
      `the ${part} of ${version} on ${platform} is ${measured[part]}, expected ${pinned[part]}. Do not deploy with it.`
    );
  }
}
// On a developer machine other projects keep their own releases here; a CI
// runner starts empty, so anything else arrived during this run.
// The CLI also leaves a lock file here (`.4.46.0.lock`); only version folders count.
const others = process.env.CI
  ? releases.filter((name) => /^\d/.test(name) && name !== version)
  : [];
if (others.length > 0) {
  fail(
    `another release is present (${others.join(', ')}): the CLI replaced the pinned version. Do not deploy with it.`
  );
}
console.log(`serverless-cli: ${version} on ${platform} matches its fingerprints`);
