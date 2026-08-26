'use strict';

/**
 * Program ID → canonical source name (matches Helius `source` strings, so the
 * downstream resource layer and the FE source-badge keep working unchanged).
 *
 * Adding a source = drop a new entry below. Adding more program IDs to an
 * existing source (e.g. a new Jupiter program version) = append to its list.
 *
 * Source name conventions:
 *   - UPPER_SNAKE_CASE
 *   - Match Helius source strings whenever they exist for a protocol so the
 *     FE doesn't need a translation table:
 *     https://www.helius.dev/docs/webhooks/transaction-types
 *   - For protocols Helius doesn't classify, pick a stable name and document it
 *     here.
 */

const {
  JUPITER_PROGRAM_IDS,
  JUPITER_LIMIT_PROGRAM_IDS,
  BUBBLEGUM_PROGRAM_ID,
} = require('../../../constants/solana-program-ids');

const SOURCES = {
  SYSTEM_PROGRAM: ['11111111111111111111111111111111'],

  TOKEN_PROGRAM: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],

  TOKEN_2022_PROGRAM: ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'],

  ASSOCIATED_TOKEN_PROGRAM: ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'],

  METAPLEX_TOKEN_METADATA: ['metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'],

  // Bubblegum (cNFT). Helius emits `source: 'BUBBLEGUM'` for these.
  BUBBLEGUM: [BUBBLEGUM_PROGRAM_ID],

  // Compression / state Merkle (cNFT support program)
  ACCOUNT_COMPRESSION: ['cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK'],

  // Jupiter aggregator routers (canonical list lives in src/constants).
  JUPITER: JUPITER_PROGRAM_IDS,

  // Jupiter Limit Orders v2.
  JUPITER_LIMIT: JUPITER_LIMIT_PROGRAM_IDS,

  // Major DEX programs (also bucketed via SWAP downstream)
  RAYDIUM: [
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // AMM v4
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Concentrated v3
  ],

  ORCA: [
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Whirlpool
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // legacy
  ],

  METEORA: [
    'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // DLMM
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Dynamic AMM
  ],

  PUMP_FUN: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],

  // NFT marketplaces
  MAGIC_EDEN: [
    'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K',
    'MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8',
  ],

  TENSOR: [
    'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
    // Tensor cNFT marketplace (TCMP) — verified via Tensor docs.
    'TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp',
  ],

  // Stake program (Solana native)
  STAKE_PROGRAM: ['Stake11111111111111111111111111111111111111'],

  // Memo (frequently used by some swaps for branding)
  MEMO_PROGRAM: ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'],

  MARINADE_FINANCE: ['MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhJlsbXxy7Z'],

  // Shared by JitoSOL and many other LST projects — distinguishing the
  // specific stake pool requires inspecting account addresses, which we
  // currently don't.
  STAKE_POOL: ['SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy'],

  SANCTUM: ['stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq'],

  JITO_TIP: ['4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7'],

  SOLEND: ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'],
  KAMINO: ['KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'],
  MARGINFI: ['MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'],

  PHOENIX: ['PhoeNiCXqGVXLVHSKvXBLPjeBxz4Hpm5JhmJaDMkEQ4'],
  OPENBOOK_V2: ['opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb'],
  LIFINITY: ['2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c'],
  SABER: ['SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ'],

  WORMHOLE: [
    'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
    'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  ],

  SNS: ['namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX'],

  // PumpSwap AMM — graduated Pump.fun bonding-curve tokens settle here.
  // Verified via solscan + Bitquery docs (2026).
  PUMP_AMM: ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'],

  // Photon trader — routing aggregator across multiple Solana DEXs.
  // Verified via Bitquery Solana Photon API docs (2026).
  PHOTON: ['BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW'],

  // Drift v2 — open-source perpetuals exchange. Verified via drift-labs/protocol-v2.
  DRIFT_V2: ['dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'],

  // Sanctum Infinity LST liquidity pool. Verified via Sanctum docs.
  SANCTUM_INFINITY: ['5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx'],

  // Moonshot launchpad (DEX Screener). Verified via solanacompass + Bitquery.
  MOONSHOT: ['MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG'],

  // Meteora Dynamic Bonding Curve — used by Jupiter LFG and others.
  // Verified via solscan + meteora docs.
  METEORA_DBC: ['dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'],

  // Helium Sub DAOs — manages dao/subnetwork structure on Solana.
  // Verified via helium/helium-program-library.
  HELIUM_DAO: ['hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR'],

  // Squads Protocol v4 — Solana multisig. Verified via Squads-Protocol/v4.
  SQUADS_V4: ['SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'],

  // Mayan Finance — cross-chain swap (Solana ↔ EVM). Verified via Mayan SDK.
  MAYAN_FINANCE: ['FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfLn6vsf'],

  // deBridge cross-chain bridge. Verified via debridge-solana-sdk.
  DEBRIDGE: ['DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh'],

  // Pyth Network legacy push oracle. Pyth is migrating consumers to the
  // pull-oracle (PYTH_RECEIVER) but the legacy program is still live on
  // mainnet for existing integrations. Verified via Pyth docs / solanacompass.
  PYTH_ORACLE: ['FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH'],

  // Switchboard On-Demand oracle program. Replaces the older Switchboard V2
  // (SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f) for new integrations.
  // Verified via Switchboard docs (2026).
  SWITCHBOARD_ORACLE: ['SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv'],

  // Raydium LaunchLab — community-powered token launchpad. Bonding-curve
  // tokens migrate to Raydium AMM on graduation. Same program ID used by
  // LetsBonk.fun, Boop.fun, and other Raydium-LaunchLab consumers.
  // Verified via Solscan + Raydium docs + Bitquery.
  LAUNCHLAB: ['LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'],

  // Pyth Pull Oracle Solana receiver. Distinct from the Pyth Network main
  // oracle program — this one is the receiver users invoke to pull price
  // updates on demand. Verified via pyth-network/pyth-crosschain SDK.
  PYTH_RECEIVER: ['pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT'],
};

/**
 * Flattened program-ID → source-name lookup, derived once from `SOURCES` at
 * module load (each program ID maps to its owning source).
 * @type {Map<string, string>}
 */
const PROGRAM_TO_SOURCE = (() => {
  const map = new Map();
  for (const [source, ids] of Object.entries(SOURCES)) {
    for (const id of ids) {
      map.set(id, source);
    }
  }
  return map;
})();

/**
 * Resolve a program ID to its canonical source name.
 * @param {string} programId - Base58 program address
 * @returns {string|null} Canonical source name (e.g. 'JUPITER'), or `null` if unknown
 */
const getSource = (programId) => PROGRAM_TO_SOURCE.get(programId) || null;

/**
 * @param {string} programId - Base58 program address
 * @returns {boolean} True for any Jupiter aggregator router program ID
 */
const isJupiter = (programId) => SOURCES.JUPITER.includes(programId);
/**
 * @param {string} programId - Base58 program address
 * @returns {boolean} True for the Metaplex token-metadata program
 */
const isMetaplex = (programId) => SOURCES.METAPLEX_TOKEN_METADATA.includes(programId);
/**
 * @param {string} programId - Base58 program address
 * @returns {boolean} True for the Bubblegum (cNFT) program
 */
const isBubblegum = (programId) => SOURCES.BUBBLEGUM.includes(programId);
/**
 * @param {string} programId - Base58 program address
 * @returns {boolean} True for the native Solana stake program
 */
const isStakeProgram = (programId) => SOURCES.STAKE_PROGRAM.includes(programId);
/**
 * @param {string} programId - Base58 program address
 * @returns {boolean} True for SPL Token or Token-2022
 */
const isToken = (programId) =>
  SOURCES.TOKEN_PROGRAM.includes(programId) || SOURCES.TOKEN_2022_PROGRAM.includes(programId);

/**
 * Source priority — when a transaction has instructions from multiple
 * sources, the source with the highest priority wins. Lower number = higher
 * priority. Aggregators (Jupiter) trump the underlying AMMs they route
 * through; marketplaces trump generic token programs.
 *
 * Priority bands group sources by semantic class so adding a new source is a
 * one-line decision: pick the band that fits the protocol's intent. The
 * absolute integer values are an implementation detail of the sort order.
 */
const PRIORITY_BANDS = {
  AGGREGATOR: 0, // Jupiter, Sanctum LST router — wraps lower-tier protocols
  LAUNCHPAD_NFT: 1, // Pump.fun, Magic Eden, Tensor — user-facing markets
  LENDING_LST: 2, // Solend / Kamino / MarginFi / Marinade / Stake Pool
  AMM: 3, // Raydium / Orca / Meteora / Phoenix / OpenBook / Lifinity / Saber
  CNFT: 4, // Bubblegum
  NFT_METADATA: 5, // Metaplex token-metadata
  STAKE: 6, // Native Solana Stake program
  TOKEN: 7, // SPL Token / Token-2022
  TOKEN_AUX: 8, // Associated Token Account program
  COMPRESSION: 9, // Account compression
  IDENTITY_TIP: 10, // SNS, JITO_TIP — peripheral markers
  MEMO: 11,
  SYSTEM: 12,
};

const SOURCE_PRIORITY = {
  JUPITER: PRIORITY_BANDS.AGGREGATOR,
  JUPITER_LIMIT: PRIORITY_BANDS.AGGREGATOR,
  SANCTUM: PRIORITY_BANDS.AGGREGATOR,

  PUMP_FUN: PRIORITY_BANDS.LAUNCHPAD_NFT,
  MAGIC_EDEN: PRIORITY_BANDS.LAUNCHPAD_NFT,
  TENSOR: PRIORITY_BANDS.LAUNCHPAD_NFT,
  WORMHOLE: PRIORITY_BANDS.LAUNCHPAD_NFT,

  MARINADE_FINANCE: PRIORITY_BANDS.LENDING_LST,
  SOLEND: PRIORITY_BANDS.LENDING_LST,
  KAMINO: PRIORITY_BANDS.LENDING_LST,
  MARGINFI: PRIORITY_BANDS.LENDING_LST,
  STAKE_POOL: PRIORITY_BANDS.LENDING_LST,

  RAYDIUM: PRIORITY_BANDS.AMM,
  ORCA: PRIORITY_BANDS.AMM,
  METEORA: PRIORITY_BANDS.AMM,
  PHOENIX: PRIORITY_BANDS.AMM,
  OPENBOOK_V2: PRIORITY_BANDS.AMM,
  LIFINITY: PRIORITY_BANDS.AMM,
  SABER: PRIORITY_BANDS.AMM,

  BUBBLEGUM: PRIORITY_BANDS.CNFT,
  METAPLEX_TOKEN_METADATA: PRIORITY_BANDS.NFT_METADATA,
  STAKE_PROGRAM: PRIORITY_BANDS.STAKE,

  TOKEN_2022_PROGRAM: PRIORITY_BANDS.TOKEN,
  TOKEN_PROGRAM: PRIORITY_BANDS.TOKEN,
  ASSOCIATED_TOKEN_PROGRAM: PRIORITY_BANDS.TOKEN_AUX,
  ACCOUNT_COMPRESSION: PRIORITY_BANDS.COMPRESSION,

  SNS: PRIORITY_BANDS.IDENTITY_TIP,
  JITO_TIP: PRIORITY_BANDS.IDENTITY_TIP,
  MEMO_PROGRAM: PRIORITY_BANDS.MEMO,
  SYSTEM_PROGRAM: PRIORITY_BANDS.SYSTEM,

  // Aggregators (route across DEXs)
  PHOTON: PRIORITY_BANDS.AGGREGATOR,
  SANCTUM_INFINITY: PRIORITY_BANDS.AGGREGATOR,

  // Launchpads + memecoin markets
  PUMP_AMM: PRIORITY_BANDS.LAUNCHPAD_NFT,
  MOONSHOT: PRIORITY_BANDS.LAUNCHPAD_NFT,
  METEORA_DBC: PRIORITY_BANDS.LAUNCHPAD_NFT,

  // Perpetuals / structured trading — same band as lending/LST
  DRIFT_V2: PRIORITY_BANDS.LENDING_LST,

  // DAO / multisig / network programs — peripheral, low priority
  HELIUM_DAO: PRIORITY_BANDS.IDENTITY_TIP,
  SQUADS_V4: PRIORITY_BANDS.IDENTITY_TIP,

  // Cross-chain bridges / aggregators
  MAYAN_FINANCE: PRIORITY_BANDS.AGGREGATOR,
  DEBRIDGE: PRIORITY_BANDS.AGGREGATOR,

  // Oracles — infrastructure, peripheral to the user-facing tx intent
  PYTH_ORACLE: PRIORITY_BANDS.IDENTITY_TIP,
  PYTH_RECEIVER: PRIORITY_BANDS.IDENTITY_TIP,
  SWITCHBOARD_ORACLE: PRIORITY_BANDS.IDENTITY_TIP,

  // Launchpads
  LAUNCHLAB: PRIORITY_BANDS.LAUNCHPAD_NFT,
};

/**
 * Choose the highest-priority source name from a list of detected sources
 * (a tx may touch multiple programs; only one source is surfaced to the FE).
 * @param {string[]} sources - Source names collected while dispatching a tx's instructions
 * @returns {string|null} The highest-priority source name, or `null` if the list is empty
 */
const pickPrimarySource = (sources) => {
  if (!sources || sources.length === 0) return null;
  const sorted = [...new Set(sources)].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a] ?? 99;
    const pb = SOURCE_PRIORITY[b] ?? 99;
    return pa - pb;
  });
  return sorted[0];
};

module.exports = {
  SOURCES,
  PROGRAM_TO_SOURCE,
  PRIORITY_BANDS,
  SOURCE_PRIORITY,
  getSource,
  pickPrimarySource,
  isJupiter,
  isMetaplex,
  isBubblegum,
  isStakeProgram,
  isToken,
};
