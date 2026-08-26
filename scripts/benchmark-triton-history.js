'use strict';

/**
 * Benchmark: OLD vs NEW Triton transaction-history fetch strategy.
 *
 * Runs both strategies against the live Triton RPC for one or more wallets and
 * reports, side by side:
 *
 *   - billed RPC method executions  (OLD = 1 getSignaturesForAddress + N
 *     getTransaction; NEW = 1 getTransactionsForAddress)
 *   - HTTP round-trips
 *   - wall-clock latency (median + min over REPS runs)
 *   - result equivalence (same signature set + same parsed tx type per sig)
 *
 * This isolates exactly what changed in the first-page history path, so the
 * before/after win is measured directly rather than inferred.
 *
 * Usage (needs TRITON_RPC_URL set + the running IP allowlisted on Triton):
 *
 *   node scripts/benchmark-triton-history.js [wallet ...] [--limit N] [--reps R]
 *
 * Run it from inside the docker container if only the container's egress IP is
 * allowlisted:
 *
 *   docker-compose exec -T api node scripts/benchmark-triton-history.js
 *
 * Defaults to the two integration-test wallets, limit 10, 5 reps.
 */

require('dotenv').config();

const tritonClient = require('../src/infrastructure/triton-client');
const tritonRpc = require('../src/services/solana/parser/triton-rpc');
const { parseTransaction } = require('../src/services/solana/parser');

const DEFAULT_WALLETS = [
  '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3',
  '7Q3Hm2QkDLJyy727sNc2AeH2vZxiPgWWXX6vTq8Ras6n',
];

const parseArgs = (argv) => {
  const wallets = [];
  let limit = 10;
  let reps = 5;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') {
      limit = parseInt(argv[(i += 1)], 10) || limit;
    } else if (arg === '--reps') {
      reps = parseInt(argv[(i += 1)], 10) || reps;
    } else {
      wallets.push(arg);
    }
  }
  return { wallets: wallets.length ? wallets : DEFAULT_WALLETS, limit, reps };
};

const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;

const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** OLD strategy: getSignaturesForAddress, then a batched getTransaction. */
const runOld = async (wallet, limit) => {
  const start = process.hrtime.bigint();
  const sigInfos = await tritonRpc.getSignaturesForAddress(wallet, { limit }, 'mainnet');
  const signatures = sigInfos.map((s) => s.signature);
  const rawTxs = await tritonRpc.getParsedTransactionsBatch(signatures, 'mainnet');
  const latency = ms(start);

  const parsed = rawTxs.map((raw, i) =>
    raw ? parseTransaction(raw, { signature: signatures[i] }) : null
  );
  return {
    latency,
    httpRoundTrips: 2, // 1 signatures call + 1 batched HTTP request
    billedMethods: 1 + signatures.length, // 1 getSignaturesForAddress + N getTransaction
    byType: typeMap(parsed),
  };
};

/** NEW strategy: a single getTransactionsForAddress call. */
const runNew = async (wallet, limit) => {
  const start = process.hrtime.bigint();
  const { transactions } = await tritonRpc.getTransactionsForAddress(wallet, { limit }, 'mainnet');
  const latency = ms(start);

  const parsed = transactions.map((entry) => {
    const signature = entry?.transaction?.signatures?.[0] || null;
    return signature ? parseTransaction(entry, { signature }) : null;
  });
  return {
    latency,
    httpRoundTrips: 1,
    billedMethods: 1, // single getTransactionsForAddress
    byType: typeMap(parsed),
  };
};

const typeMap = (parsed) => {
  const map = new Map();
  parsed.forEach((tx) => {
    if (tx?.signature) map.set(tx.signature, tx.type);
  });
  return map;
};

/** Compare the two parsed result sets: same signatures, same per-sig type. */
const equivalence = (oldMap, newMap) => {
  const oldSigs = [...oldMap.keys()];
  const newSigs = [...newMap.keys()];
  const sameSet = oldSigs.length === newSigs.length && oldSigs.every((sig) => newMap.has(sig));
  const typeMismatches = oldSigs
    .filter((sig) => newMap.has(sig) && oldMap.get(sig) !== newMap.get(sig))
    .map((sig) => `${sig.slice(0, 8)}… old=${oldMap.get(sig)} new=${newMap.get(sig)}`);
  return { sameSet, oldCount: oldSigs.length, newCount: newSigs.length, typeMismatches };
};

const pct = (oldV, newV) => (oldV === 0 ? '—' : `${Math.round((1 - newV / oldV) * 100)}%`);

const benchmarkWallet = async (wallet, limit, reps) => {
  console.log(`\n── wallet ${wallet} (limit ${limit}, ${reps} reps) ──`);

  // Warm one run of each for the equivalence check + correctness gate.
  const oldWarm = await runOld(wallet, limit);
  const newWarm = await runNew(wallet, limit);

  const eq = equivalence(oldWarm.byType, newWarm.byType);
  console.log(
    `  results: OLD ${eq.oldCount} txs / NEW ${eq.newCount} txs — ` +
      `signature set ${eq.sameSet ? 'IDENTICAL ✓' : 'DIFFERENT ✗'}`
  );
  if (eq.typeMismatches.length) {
    console.log(`  ⚠️  parsed-type mismatches: ${eq.typeMismatches.join('; ')}`);
  }

  const oldLatencies = [oldWarm.latency];
  const newLatencies = [newWarm.latency];
  for (let i = 1; i < reps; i += 1) {
    oldLatencies.push((await runOld(wallet, limit)).latency);
    newLatencies.push((await runNew(wallet, limit)).latency);
  }

  const oldMed = median(oldLatencies);
  const newMed = median(newLatencies);

  console.log('  ┌────────────────────┬──────────┬──────────┬──────────┐');
  console.log('  │ metric             │   OLD    │   NEW    │  saved   │');
  console.log('  ├────────────────────┼──────────┼──────────┼──────────┤');
  console.log(
    `  │ billed RPC methods │ ${String(oldWarm.billedMethods).padStart(8)} │ ${String(
      newWarm.billedMethods
    ).padStart(8)} │ ${pct(oldWarm.billedMethods, newWarm.billedMethods).padStart(8)} │`
  );
  console.log(
    `  │ HTTP round-trips   │ ${String(oldWarm.httpRoundTrips).padStart(8)} │ ${String(
      newWarm.httpRoundTrips
    ).padStart(8)} │ ${pct(oldWarm.httpRoundTrips, newWarm.httpRoundTrips).padStart(8)} │`
  );
  console.log(
    `  │ latency median ms  │ ${oldMed.toFixed(0).padStart(8)} │ ${newMed
      .toFixed(0)
      .padStart(8)} │ ${pct(oldMed, newMed).padStart(8)} │`
  );
  console.log(
    `  │ latency min ms     │ ${Math.min(...oldLatencies)
      .toFixed(0)
      .padStart(8)} │ ${Math.min(...newLatencies)
      .toFixed(0)
      .padStart(8)} │ ${pct(Math.min(...oldLatencies), Math.min(...newLatencies)).padStart(8)} │`
  );
  console.log('  └────────────────────┴──────────┴──────────┴──────────┘');
};

const main = async () => {
  const { wallets, limit, reps } = parseArgs(process.argv.slice(2));

  if (!process.env.TRITON_RPC_URL) {
    console.error('TRITON_RPC_URL is not set. Load .env or run inside the docker container.');
    process.exit(1);
  }

  // Fail fast on auth / allowlist before timing anything.
  try {
    const axios = require('axios');
    const { data } = await axios.post(
      tritonClient.getRpcUrl('mainnet'),
      { jsonrpc: '2.0', id: 'probe', method: 'getHealth' },
      { timeout: 5000 }
    );
    if (data?.error) throw new Error(`${data.error.code}: ${data.error.message}`);
  } catch (error) {
    const status = error.response?.status;
    console.error(`Triton probe failed${status ? ` (HTTP ${status})` : ''}: ${error.message}`);
    console.error('Check TRITON_RPC_URL + that this IP is allowlisted on Triton.');
    process.exit(1);
  }

  for (const wallet of wallets) {
    try {
      await benchmarkWallet(wallet, limit, reps);
    } catch (error) {
      console.error(`  benchmark failed for ${wallet}: ${error.message}`);
    }
  }
};

main();
