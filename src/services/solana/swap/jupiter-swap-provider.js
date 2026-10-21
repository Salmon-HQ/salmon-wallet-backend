'use strict';

/**
 * Jupiter Swap API v2 Router adapter (`GET /swap/v2/build`).
 *
 * The Router path returns quote numbers plus instruction groups and the
 * addresses of the lookup tables they need — never a serialized or signed
 * transaction, which is why `/swap/v2/order` + `/execute` (Jupiter assembles
 * and broadcasts) are never used (root `AGENTS.md` "Signing boundary").
 * This module owns Jupiter's wire format (base58 program ids, base64
 * instruction data, `platformFeeBps` + `feeAccount`) and hands back
 * web3.js instructions; assembling the transaction is
 * `solana-swap-build-service`.
 *
 * Jupiter's own compute-budget instructions are dropped: the shared builder
 * prepends its own. Its blockhash is ignored for the same reason. The
 * platform fee is taken from the OUTPUT token on ExactIn, so `feeAccount`
 * must be a token account of the output mint (the owner's wrapped-SOL
 * account for SOL, never the wallet itself), which `FEE` tells the build
 * service. Probed 2026-09-30 with the production key: the Router path
 * charges no Jupiter fee; `x-ratelimit-limit` is 10 per second.
 *
 * Docs: https://dev.jup.ag/docs/swap/v2
 */

const http = require('axios');
const { PublicKey, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const { providerCall } = require('../../../infrastructure/providers/provider-client');
const { remainingMs } = require('../../../infrastructure/providers/request-deadline');
const { SolanaSwapError, SolanaSwapNoRouteError } = require('./solana-swap-errors');

/**
 * `/swap/v2/build` routes through Metis, Jupiter's onchain router. Jupiter's
 * API licence (§2.3) makes it mandatory to state "Metis" prominently to end
 * users and calls labelling the output "Jupiter" alone misleading, so the
 * attribution names the router first.
 */
const PROVIDER = { id: 'jupiter', displayName: 'Metis', attribution: 'Powered by Metis (Jupiter)' };
/** Fee only from the output side, into a token account (wrapped SOL for SOL). */
const FEE = { sides: ['buy'], nativeSolAsWallet: false };
const JUPITER_API_URL = process.env.JUPITER_SWAP_API_URL || 'https://api.jup.ag/swap/v2';

/** The table may name Jupiter for a country only if the credential is there. */
const isConfigured = () => Boolean(process.env.JUPITER_API_KEY);

const headers = () => ({ 'x-api-key': process.env.JUPITER_API_KEY || '' });

const toInstruction = (raw) =>
  new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(raw.data, 'base64'),
  });

/**
 * Jupiter answers a refused build with `{ error: string }`, or with
 * `{ error: { name: 'ZodError', issues } }` when the query shape itself is
 * wrong. Texts observed live on 2026-10-01 against `/swap/v2/build`:
 *   "No routes found"                      — pair, amount or an unknown mint
 *   "inputMint cannot be same as outputMint"
 *   "Invalid inputMint" / "Invalid outputMint" / "Invalid taker" / "Invalid amount"
 *   "Invalid feeAccount" / "feeAccount is required when platformFeeBps is positive"
 *   ZodError on `slippageBps` (> 10000), missing `taker` / `amount`
 * Anything the controller already validates (mints, taker, amount, slippage
 * bounds) can only reach Jupiter through our own bug, and so can a fee
 * account it refuses: those are 500 `swap_misconfigured`, logged. A pair it
 * cannot route is 404 `no_route`.
 */
const JUPITER_ERROR_MAP = [
  [/^No routes found/i, 404, 'no_route'],
  [/cannot be same as/i, 400, 'invalid_parameter'],
  [/^Invalid (inputMint|outputMint|taker|amount)\b/i, 500, 'swap_misconfigured'],
  [/feeAccount/i, 500, 'swap_misconfigured'],
];

/** Human-readable reason from either envelope, the first Zod issue included. */
const upstreamReason = (data) => {
  const error = data?.error;
  if (typeof error === 'string') return error;
  const issue = Array.isArray(error?.issues) ? error.issues[0] : null;
  if (issue) return `${(issue.path || []).join('.') || 'request'}: ${issue.message}`;
  if (typeof data?.message === 'string') return data.message;
  return 'No route available';
};

/** Translate a Jupiter 4xx into the public envelope; null when it is not ours to translate. */
const toSwapError = (status, data) => {
  const reason = upstreamReason(data);
  const misconfigured = (why) => {
    console.error('[SWAP_MISCONFIGURED] Jupiter rejected our own request parameters', {
      why,
      data,
    });
    return new SolanaSwapError(reason, 500, 'swap_misconfigured');
  };
  if (data?.error?.name === 'ZodError') return misconfigured('request shape');
  for (const [pattern, mappedStatus, code] of JUPITER_ERROR_MAP) {
    if (pattern.test(reason)) {
      return mappedStatus === 500
        ? misconfigured(code)
        : new SolanaSwapError(reason, mappedStatus, code);
    }
  }
  if (status === 400 || status === 404 || status === 422) return new SolanaSwapNoRouteError(reason);
  return null;
};

const isInstruction = (raw) =>
  Boolean(raw) &&
  typeof raw.programId === 'string' &&
  Array.isArray(raw.accounts) &&
  typeof raw.data === 'string';

/**
 * A 200 whose shape is not the one this adapter was written against is a
 * provider defect, never signable bytes: a missing swap instruction would
 * otherwise build a transaction that sets accounts up and swaps nothing.
 * @throws {SolanaSwapError} 502 `provider_bad_response`
 */
const assertBuildShape = (data) => {
  const ok =
    Boolean(data) &&
    isInstruction(data.swapInstruction) &&
    /^\d+$/.test(String(data.outAmount)) &&
    /^\d+$/.test(String(data.otherAmountThreshold)) &&
    (data.setupInstructions === undefined || data.setupInstructions.every(isInstruction)) &&
    (data.cleanupInstruction == null || isInstruction(data.cleanupInstruction)) &&
    (data.otherInstructions === undefined || data.otherInstructions.every(isInstruction));
  if (!ok) {
    console.error('[SWAP_PROVIDER_BAD_RESPONSE]', { provider: 'jupiter' });
    throw new SolanaSwapError(
      'Jupiter answered with an unexpected shape',
      502,
      'provider_bad_response'
    );
  }
};

const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM_ID.toBase58()]);
/** System `Transfer`: u32 discriminator 2 + u64 lamports. */
const SYSTEM_TRANSFER = 2;
/** SPL Token discriminators: `CloseAccount` 9, `SyncNative` 17. */
const CLOSE_ACCOUNT = 9;
const SYNC_NATIVE = 17;

const ataOf = (owner, mint, tokenProgram) =>
  getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(owner),
    true,
    new PublicKey(tokenProgram)
  ).toBase58();

const keyAt = (ix, index) => ix.keys[index]?.pubkey.toBase58();

/**
 * Whether one instruction around the router call is something a Jupiter
 * build needs for this taker — probed against live `/build` answers: create
 * the taker's own token accounts, wrap SOL into the taker's wrapped-SOL
 * account (transfer + `SyncNative`) and unwrap it back to the taker
 * (`CloseAccount`). Everything else is refused, because every program on the
 * swap allowlist can also move the taker's funds once the taker signs:
 * a System transfer to a stranger, an SPL `Approve`, `SetAuthority`, a close
 * paying someone else, an `Assign`. Compute-budget instructions are refused
 * too: the shared builder sets its own.
 */
const isTakerSupport = (ix, taker, wrappedSol) => {
  const program = ix.programId.toBase58();
  const { data } = ix;
  if (program === ATA_PROGRAM) {
    // `Create` (no data or 0) / `CreateIdempotent` (1): payer, ata, owner, mint, system, token program.
    const tokenProgram = keyAt(ix, 5);
    return (
      ix.keys.length >= 6 &&
      data.length <= 1 &&
      (data[0] ?? 0) <= 1 &&
      keyAt(ix, 0) === taker &&
      keyAt(ix, 2) === taker &&
      keyAt(ix, 4) === SYSTEM_PROGRAM &&
      TOKEN_PROGRAMS.has(tokenProgram) &&
      keyAt(ix, 1) === ataOf(taker, keyAt(ix, 3), tokenProgram)
    );
  }
  if (program === SYSTEM_PROGRAM) {
    return (
      data.length === 12 &&
      data.readUInt32LE(0) === SYSTEM_TRANSFER &&
      keyAt(ix, 0) === taker &&
      keyAt(ix, 1) === wrappedSol
    );
  }
  if (program === TOKEN_PROGRAM && data.length === 1) {
    if (data[0] === SYNC_NATIVE) return keyAt(ix, 0) === wrappedSol;
    // CloseAccount: account, rent destination, authority.
    if (data[0] === CLOSE_ACCOUNT) {
      return keyAt(ix, 0) === wrappedSol && keyAt(ix, 1) === taker && keyAt(ix, 2) === taker;
    }
  }
  return false;
};

/**
 * The two router calls `/build` answers with (probed live: about a third of
 * the builds use the shared-accounts form), by Anchor discriminator. Both
 * carry in u64, quoted out u64, slippage u16 and platform fee u16 from
 * `args` on (the shared form puts a u8 route id first), then a route plan
 * whose length varies with the number of hops. `override` is `route_v2`'s
 * optional destination override, empty when it holds the program's own id.
 */
const ROUTES = {
  bb64facc31c4af14: {
    name: 'route_v2',
    args: 8,
    authority: 0,
    source: 1,
    destination: 2,
    override: 7,
  },
  d19853937cfed8e9: {
    name: 'shared_accounts_route_v2',
    args: 9,
    authority: 1,
    source: 2,
    destination: 5,
  },
};
const ROUTE_ARGS_BYTES = 8 + 8 + 2 + 2;
const BPS = 10000n;

const takerAtas = (taker, mint) => [...TOKEN_PROGRAMS].map((p) => ataOf(taker, mint, p));

/**
 * Why the router call is not this request's swap, or null when it is. The
 * call is what moves the swap's whole value: it must spend the input token
 * from the taker's own account, pay the output into the taker's own account,
 * and carry the amount, slippage and fee Salmon asked for. The quote the
 * wallet shows is bound to the quote the program enforces.
 */
const routeMismatch = (ix, request, quote) => {
  const { data } = ix;
  const discriminator = data.subarray(0, 8).toString('hex');
  const route = Object.hasOwn(ROUTES, discriminator) ? ROUTES[discriminator] : null;
  if (!route) return `unknown router call ${discriminator || 'empty'}`;
  const why = (check) => `${route.name} ${check}`;
  const at = route.args;
  if (data.length < at + ROUTE_ARGS_BYTES) return why('data too short');
  if (keyAt(ix, route.authority) !== request.taker) return why('authority');
  const source = keyAt(ix, route.source);
  if (!takerAtas(request.taker, request.inputMint).includes(source)) return why('source');
  const destination = keyAt(ix, route.destination);
  if (!takerAtas(request.taker, request.outputMint).includes(destination)) {
    return why('destination');
  }
  if (route.override !== undefined && keyAt(ix, route.override) !== JUPITER_PROGRAM) {
    return why('destination override');
  }
  if (data.readBigUInt64LE(at) !== BigInt(request.amount)) return why('in amount');
  const quoted = data.readBigUInt64LE(at + 8);
  if (String(quoted) !== String(quote.outAmount)) return why('quoted out amount');
  const slippage = data.readUInt16LE(at + 16);
  if (slippage !== request.slippageBps) return why('slippage');
  if (data.readUInt16LE(at + 18) !== (request.fee?.bps ?? 0)) return why('platform fee');
  // Jupiter rounds the minimum up; within one base unit either way is the same minimum.
  const gap = BigInt(quote.otherAmountThreshold) * BPS - quoted * (BPS - BigInt(slippage));
  if (gap <= -BPS || gap >= BPS) return why('minimum out amount');
  return null;
};

/**
 * Refuse a build that does anything but this taker's own swap: Jupiter's
 * answer is not signed (unlike 0x's), so a tampered or faulty one must not
 * reach the wallet as signable bytes.
 * @throws {SolanaSwapError} 502 `provider_bad_response`
 */
const assertTakerOnly = ({ swap, support }, request, quote) => {
  const refuse = (reason) => {
    console.error('[SWAP_PROVIDER_BAD_RESPONSE]', { provider: 'jupiter', reason });
    throw new SolanaSwapError(
      'Jupiter answered with instructions a swap does not need',
      502,
      'provider_bad_response'
    );
  };
  if (swap.programId.toBase58() !== JUPITER_PROGRAM) refuse('swap instruction is not Jupiter');
  const mismatch = routeMismatch(swap, request, quote);
  if (mismatch) refuse(mismatch);
  const wrappedSol = ataOf(request.taker, NATIVE_MINT, TOKEN_PROGRAM);
  const stray = support.find((ix) => !isTakerSupport(ix, request.taker, wrappedSol));
  if (stray) refuse(`instruction ${stray.data[0] ?? 'empty'} on ${stray.programId.toBase58()}`);
};

/** Discriminator of the shared-accounts router call, which installed wallets refuse. */
const SHARED_ROUTE = 'd19853937cfed8e9';
const JUPITER_BUILD_ATTEMPTS = 3;
/** A retry needs room for one Jupiter call (10 s cap) plus the simulation that follows. */
const RETRY_MIN_REMAINING_MS = 15000;

/** Hex discriminator of the answer's router call, or null when it has none. */
const routerCallOf = (data) =>
  typeof data?.swapInstruction?.data === 'string'
    ? Buffer.from(data.swapInstruction.data, 'base64').subarray(0, 8).toString('hex')
    : null;

/**
 * One `/build` call, its refusals mapped onto the public envelope.
 * @throws {SolanaSwapError} 404 `no_route`, 500 `swap_misconfigured`, 503 on 401/403/429.
 */
const fetchBuild = async (params) => {
  try {
    const { data } = await providerCall(
      'jupiter',
      ({ timeout, signal }) =>
        http.get(`${JUPITER_API_URL}/build`, { params, timeout, signal, headers: headers() }),
      { operationName: `Jupiter swap build (${params.inputMint} → ${params.outputMint})` }
    );
    return data;
  } catch (error) {
    const status = error.response?.status;
    if (status === 429) {
      throw new SolanaSwapError(
        'Jupiter rate limit exceeded; retry shortly',
        503,
        'upstream_rate_limited'
      );
    }
    if (status === 401 || status === 403) {
      // Our credential, never the caller's wallet: the raw error carries the
      // request headers, so it is replaced rather than rethrown.
      console.error('[SWAP_PROVIDER_AUTH]', { provider: 'jupiter', status });
      throw new SolanaSwapError('Jupiter refused our credentials', 503, 'upstream_unavailable');
    }
    const mapped = status ? toSwapError(status, error.response.data) : null;
    if (mapped) {
      console.warn('Jupiter swap build rejected the request:', error.response.data);
      throw mapped;
    }
    throw error;
  }
};

/**
 * Request swap instructions from Jupiter.
 *
 * @param {Object} params
 * @param {string} params.inputMint
 * @param {string} params.outputMint
 * @param {string} params.amount - input amount in base units.
 * @param {string} params.taker - user's public key (signer + fee payer).
 * @param {number} params.slippageBps
 * @param {{ recipient: string, bps: number, side: 'buy' }|null} params.fee - Salmon's fee;
 *   `recipient` is an existing token account of the output mint.
 * @returns {Promise<{ instructions: TransactionInstruction[], lookupTableAddresses: string[],
 *   amountOut: string, minAmountOut: string, routePlan: Array<{ label: string, percent: number }>,
 *   providerRequestId: null, routeFee: null }>}
 * @throws {SolanaSwapError} 404 `no_route`, 500 `swap_misconfigured`, 502 `provider_bad_response`
 *   (unexpected shape, or instructions beyond the taker's own swap), 503 `upstream_rate_limited`.
 */
const requestSwapInstructions = async ({
  inputMint,
  outputMint,
  amount,
  taker,
  slippageBps,
  fee,
}) => {
  const params = {
    inputMint,
    outputMint,
    amount,
    taker,
    slippageBps,
    ...(fee ? { platformFeeBps: fee.bps, feeAccount: fee.recipient } : {}),
  };

  let data = await fetchBuild(params);
  // ponytail: installed wallets verify only route_v2, so a shared-accounts
  // answer is asked again (sequentially, inside the request budget) before
  // it is returned. Remove once wallets that accept shared_accounts_route_v2
  // are the only ones in use; each retry spends the org's 600/min quota.
  if (routerCallOf(data) === SHARED_ROUTE) {
    let attempts = 1;
    let retryError;
    while (attempts < JUPITER_BUILD_ATTEMPTS && remainingMs() > RETRY_MIN_REMAINING_MS) {
      attempts += 1;
      try {
        const next = await fetchBuild(params);
        if (routerCallOf(next) !== SHARED_ROUTE) {
          data = next;
          break;
        }
      } catch (error) {
        retryError = error.errorCode || 'unknown';
        break;
      }
    }
    const route = routerCallOf(data) === SHARED_ROUTE ? 'shared_accounts_route_v2' : 'route_v2';
    console.warn('[SWAP_JUPITER_SHARED_RETRY]', {
      attempts,
      route,
      ...(retryError ? { retryError } : {}),
    });
  }

  assertBuildShape(data);

  // Order per Jupiter's reference assembly; `computeBudgetInstructions` and
  // `tipInstruction` (Jito) are ours to decide and are left out.
  const setup = (data.setupInstructions || []).map(toInstruction);
  const swap = toInstruction(data.swapInstruction);
  const after = [data.cleanupInstruction, ...(data.otherInstructions || [])]
    .filter(Boolean)
    .map(toInstruction);
  assertTakerOnly(
    { swap, support: [...setup, ...after] },
    { taker, inputMint, outputMint, amount, slippageBps, fee },
    data
  );
  const instructions = [...setup, swap, ...after];

  return {
    instructions,
    lookupTableAddresses: Object.keys(data.addressesByLookupTableAddress || {}),
    amountOut: String(data.outAmount),
    minAmountOut: String(data.otherAmountThreshold),
    routePlan: (data.routePlan || []).map((leg) => ({
      label: leg.swapInfo?.label ?? 'unknown',
      percent: Number(leg.percent),
    })),
    providerRequestId: null,
    routeFee: null,
  };
};

module.exports = { requestSwapInstructions, isConfigured, PROVIDER, FEE, JUPITER_ERROR_MAP };
