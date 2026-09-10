'use strict';

/**
 * Public shape of `GET /ft/swap/build` (`solana-swap-build` contract).
 *
 * Hydrates the build result with token metadata (Jupiter Tokens v2) and USD
 * values (Jupiter Price v3) so the wallet can render the review screen
 * without extra lookups. Amounts are base-unit strings. The provider is data
 * (`provider`, `providerDisplayName`, `attribution`): the client renders the
 * attribution from these fields and has no provider-specific branches.
 */

const jupiterTokenService = require('../../services/solana/jupiter-token-service');
const jupiterService = require('../../services/solana/jupiter-service');

const PPB_PER_PERCENT = 10000000;

const mapToken = (token, mint, extra) => ({
  mint,
  decimals: token?.decimals,
  symbol: token?.symbol,
  name: token?.name,
  logo: token?.icon || token?.logoURI,
  ...extra,
});

const usdValue = (amount, token, price) => {
  if (!price || typeof token?.decimals !== 'number') {
    return null;
  }
  return (Number(amount) / Math.pow(10, token.decimals)) * price;
};

/** Percentage lost between input and output USD value; null when either price is unknown. */
const priceImpactPct = (inUsd, outUsd) => {
  if (!inUsd || outUsd === null) {
    return null;
  }
  return Number((((inUsd - outUsd) / inUsd) * 100).toFixed(4));
};

const feeLine = (fee, token) =>
  fee ? { ...fee, decimals: token?.decimals, symbol: token?.symbol } : null;

module.exports = async (build, _include, _key, context) => {
  const { inputMint, outputMint } = build;
  const mints = [...new Set([inputMint, outputMint])];
  const [tokens, prices] = await Promise.all([
    jupiterTokenService.getTokensByMints(mints, context.locals),
    jupiterService.getQuotes(mints, context.locals).catch((error) => {
      console.warn('Swap build: USD prices unavailable:', error.message);
      return new Map();
    }),
  ]);
  const tokenFor = (mint) => tokens.find((t) => (t.id || t.address) === mint);
  const inputToken = tokenFor(inputMint);
  const outputToken = tokenFor(outputMint);

  const inUsdValue = usdValue(build.amountIn, inputToken, prices.get(inputMint)?.usdPrice);
  const outUsdValue = usdValue(build.amountOut, outputToken, prices.get(outputMint)?.usdPrice);

  return {
    provider: build.provider.id,
    providerDisplayName: build.provider.displayName,
    attribution: build.provider.attribution,
    providerRequestId: build.providerRequestId,
    transaction: build.transaction,
    expiresAt: build.expiresAt,
    input: mapToken(inputToken, inputMint, { amount: build.amountIn }),
    output: mapToken(outputToken, outputMint, {
      amount: build.amountOut,
      minAmount: build.minAmountOut,
    }),
    route: build.routePlan.map((leg) => ({
      label: leg.dex_label,
      percent: leg.ppb / PPB_PER_PERCENT,
    })),
    priceImpactPct: priceImpactPct(inUsdValue, outUsdValue),
    slippageBps: build.slippageBps,
    inUsdValue,
    outUsdValue,
    salmonFee: feeLine(build.salmonFee, outputToken),
    routeFee: null,
  };
};
