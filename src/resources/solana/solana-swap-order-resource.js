'use strict';

const jupiterTokenService = require('../../services/solana/jupiter-token-service');

const mapToken = (amount, token) => {
  return {
    amount,
    decimals: token?.decimals,
    symbol: token?.symbol,
    name: token?.name,
    logo: token?.icon || token?.logoURI,
    contract: token?.id || token?.address,
  };
};

/**
 * Calculate the swap fee from a Jupiter Ultra v1 order.
 *
 * `feeBps` is the total fee Jupiter applied (Ultra's default 5–10 bps, or the
 * configured referral bps when a referral account is wired), charged against
 * the input amount. `inputAmount` is already in the input token's smallest
 * units, so the fee is `inputAmount * feeBps / 10000` in those same units and
 * is labelled with the input token's own decimals and symbol.
 *
 * This previously multiplied those base units by a USD price from
 * `jupiterService.price` and labelled the result SOL/9-decimals, which is
 * meaningless for any non-SOL input: Jupiter Price v3 returns `usdPrice` per
 * whole token, not per base unit, and the fee is not denominated in SOL.
 *
 * @param {string|number} inputAmount - Input amount in the input token's smallest units.
 * @param {number} feeBps - Total fee in basis points, from the Ultra order.
 * @param {{decimals?: number, symbol?: string}} [inputToken] - Input token metadata.
 * @returns {{amount: number, decimals: number|undefined, symbol: string|undefined,
 *   percent: number}|null} Null when there is no fee or no usable input amount.
 */
const calculateFee = (inputAmount, feeBps, inputToken) => {
  const amount = Number(inputAmount);
  if (!feeBps || !Number.isFinite(amount)) {
    return null;
  }

  return {
    amount: Math.round((amount * feeBps) / 10000),
    decimals: inputToken?.decimals,
    symbol: inputToken?.symbol,
    percent: feeBps / 100, // Convert bps to percentage (e.g., 100 bps = 1%)
  };
};

/**
 * Resource decorator for a Jupiter Ultra v1 swap order. Hydrates the
 * raw order with token metadata, route names/symbols, fee breakdown,
 * and a `custom` payload carrying the Ultra-specific fields needed to
 * execute the swap.
 *
 * @param {object} order - Ultra `/order` response. Read fields:
 *   `transaction`, `requestId`, `router`, `outAmount`, `priceImpact`,
 *   `feeBps`, `prioritizationFeeLamports`, `rentFeeLamports`,
 *   `gasless`, `routePlan` (array of `{inputMint, outputMint, inAmount,
 *   label}`), `slippageBps`, `swapMode`, `otherAmountThreshold`,
 *   `inUsdValue`, `outUsdValue`.
 * @param {object} include - relation include map (unused here).
 * @param {string} key - decorator chain key (unused here).
 * @param {{locals: object}} context - per-request context. `locals` is
 *   forwarded to `jupiterTokenService.getTokensByMints`.
 * @returns {Promise<{
 *   routeNames: (string|null)[],
 *   routeSymbols: (string|null)[],
 *   fee: ({amount: number, decimals: number, symbol: string, percent: number} | null),
 *   input: {amount: number, decimals: number, symbol: string, name: string, logo: string, contract: string},
 *   output: {amount: number, decimals: number, symbol: string, name: string, logo: string, contract: string},
 *   custom: {
 *     transaction: string, requestId: string, router: string,
 *     priceImpact: number, feeBps: number,
 *     prioritizationFeeLamports: number, rentFeeLamports: number,
 *     gasless: boolean, slippageBps: number, swapMode: string,
 *     otherAmountThreshold: number,
 *     inUsdValue: number, outUsdValue: number,
 *   }
 * }>}
 *
 * Fee contract: delegates to `calculateFee(inAmount, feeBps,
 * inputToken)`. `amount` is denominated in the INPUT token's smallest
 * units and `decimals`/`symbol` describe that same token. Returns
 * `null` when `feeBps` is missing or `inAmount` is not numeric.
 */
module.exports = async (order, include, key, context) => {
  // Ultra v1/order response structure
  const {
    transaction,
    requestId,
    router,
    inAmount: orderInAmount,
    outAmount,
    priceImpact,
    feeBps,
    prioritizationFeeLamports,
    rentFeeLamports,
    gasless,
    routePlan = [],
    slippageBps,
    swapMode,
    otherAmountThreshold,
    inUsdValue,
    outUsdValue,
  } = order || {};

  // Jupiter Ultra v1 nests step data inside `swapInfo`; legacy V6 returned
  // those fields flat on the step. Accept both shapes so the resource works
  // across providers without coupling callers to a single response form.
  const stepInfo = (step) => (step && step.swapInfo) || step || {};

  // Extract input mint from routePlan, but take the amount from the order
  // itself. `routePlan[0].inAmount` is what entered the FIRST leg, which is
  // not what the user spends: some routers deduct the platform fee before
  // routing (observed live: a 100000000 order whose first leg carried
  // 99500000), and a route split at the first hop only carries a fraction.
  // Both understate `input.amount` — the figure shown as the debit — and the
  // fee derived from it. `outAmount` already comes from the order top level.
  const inputMint = stepInfo(routePlan[0]).inputMint;
  const inAmount = orderInAmount ?? stepInfo(routePlan[0]).inAmount;

  // Build route mints array
  const routeMints = [];
  if (inputMint) {
    routeMints.push(inputMint);
  }
  routePlan.forEach((step) => {
    const outputMint = stepInfo(step).outputMint;
    if (outputMint && !routeMints.includes(outputMint)) {
      routeMints.push(outputMint);
    }
  });

  // Fetch only the tokens needed for this swap using Jupiter V2 API
  const tokens = await jupiterTokenService.getTokensByMints(routeMints, context.locals);
  const routeTokens = routeMints.map((mint) => tokens.find((t) => t.id === mint));

  const inputToken = routeTokens.at(0);
  const outputToken = routeTokens.at(-1);

  // Extract route names and symbols from routePlan
  const routeNames = routePlan.map((step) => stepInfo(step).label || null);
  const routeSymbols = routeTokens.map(({ symbol } = {}) => symbol || null);

  return {
    routeNames,
    routeSymbols,
    fee: calculateFee(inAmount, feeBps, inputToken),
    input: mapToken(inAmount, inputToken),
    output: mapToken(outAmount, outputToken),
    custom: {
      transaction, // Base64 unsigned transaction
      requestId, // Required for execute endpoint
      router, // e.g. metis, jupiterz, dflow, okx
      priceImpact, // Price impact percentage
      feeBps, // Total fees in basis points
      prioritizationFeeLamports,
      rentFeeLamports,
      gasless, // Gasless swap indicator
      slippageBps, // Slippage tolerance in basis points
      swapMode, // ExactIn or ExactOut
      otherAmountThreshold, // Minimum output amount after slippage
      inUsdValue, // Input amount USD value
      outUsdValue, // Output amount USD value
    },
  };
};
