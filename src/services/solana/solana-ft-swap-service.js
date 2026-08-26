'use strict';

/**
 * Solana fungible-token swap service.
 *
 * Wraps the Jupiter swap API (order + execute), migrating from Ultra v1
 * to the unified swap/v2 endpoint, with rate limiting, retries, and
 * optional referral fees.
 */

const http = require('axios');
const {
  withRetry,
  rateLimiter,
} = require('../../infrastructure/rate-limiting/jupiter-rate-limiter');
const { getByMints } = require('./solana-ft-service');
const { SOL_ADDRESS, SOL_DECIMALS } = require('../../constants/solana-constants');

const JUPITER_SWAP_URL = process.env.JUPITER_SWAP_URL;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const REFERRAL_FEE_BPS = process.env.JUPITER_SWAP_REFERRAL_FEE_BPS
  ? parseInt(process.env.JUPITER_SWAP_REFERRAL_FEE_BPS)
  : null;
const REFERRAL_ACCOUNT = process.env.JUPITER_SWAP_REFERRAL_ACCOUNT || null;
const ORDER_TIMEOUT = 10000;
const EXECUTE_TIMEOUT = 30000;

const buildHeaders = (headers = {}) => {
  const result = { ...headers };
  if (JUPITER_API_KEY) {
    result['x-api-key'] = JUPITER_API_KEY;
  }
  return result;
};

const getReferralParams = () => {
  if (!REFERRAL_FEE_BPS || !REFERRAL_ACCOUNT) {
    return {};
  }

  return {
    referralAccount: REFERRAL_ACCOUNT,
    referralFee: REFERRAL_FEE_BPS,
  };
};

const logOrderError = (error, url, params) => {
  console.error('Jupiter Ultra Order API Error:', {
    status: error.response?.status,
    statusText: error.response?.statusText,
    data: error.response?.data,
    url,
    params,
  });
};

/**
 * Detect a referral fee that Jupiter did not apply.
 *
 * When `referralAccount` + `referralFee` are sent, Jupiter documents the
 * returned `feeBps` as the total fee, equal to the requested `referralFee`
 * (Jupiter's own cut comes out of it, not on top). If the referral token
 * account for the `feeMint` Jupiter picked does not exist, "the order will
 * still return and can be executed without your fees" and `feeBps` falls
 * back to Ultra's default 5–10 bps — silently, with no error field. That is
 * pure revenue loss, so a lower-than-requested `feeBps` gets a greppable
 * error log. Log-only: the order is still served.
 *
 * @param {Object} data - Ultra `/order` response.
 * @returns {void}
 */
const warnOnUnappliedReferralFee = (data) => {
  if (!REFERRAL_FEE_BPS || !REFERRAL_ACCOUNT) {
    return;
  }

  const appliedFeeBps = Number(data?.feeBps);
  if (!Number.isFinite(appliedFeeBps) || appliedFeeBps >= REFERRAL_FEE_BPS) {
    return;
  }

  console.error('[JUPITER_REFERRAL_FEE_NOT_APPLIED] Jupiter applied less than the referral fee', {
    expectedFeeBps: REFERRAL_FEE_BPS,
    appliedFeeBps,
    feeMint: data?.feeMint,
    referralAccount: REFERRAL_ACCOUNT,
    router: data?.router,
    likelyCause: `missing referral token account for feeMint ${data?.feeMint}`,
  });
};

const getOrderResult = (data) => {
  if (data.transaction) {
    warnOnUnappliedReferralFee(data);
    return data;
  }

  console.warn(
    `No transaction generated. ErrorCode: ${data.errorCode}, Message: ${data.errorMessage}`
  );
  return null;
};

/**
 * Raises the 404 `execution_failed` the contract specifies, but carrying the
 * provider's own reason.
 *
 * The reason matters: the wallet classifies swap failures by matching the
 * message text (slippage, expired quote, insufficient funds...), so collapsing
 * every failure into the literal "Transaction execution failed" made a
 * slippage rejection indistinguishable from an infrastructure fault, and the
 * user got "The transaction failed. Please try again." for a swap that needed
 * a different slippage setting.
 *
 * @param {Object} data - Raw Ultra `/execute` response.
 * @returns {Error}
 */
const buildExecutionFailedError = (data) => {
  const reason = data.error || 'Transaction execution failed';
  const error = new Error(data.code ? `${reason} (code ${data.code})` : reason);
  error.statusCode = 404;
  error.errorCode = 'execution_failed';
  return error;
};

const getExecuteResult = (data) => {
  console.info('Jupiter Ultra Execute Response:', {
    status: data.status,
    signature: data.signature,
    slot: data.slot,
    swapEventsCount: data.swapEvents?.length || 0,
    error: data.error,
  });

  // Success is a whitelist, per Jupiter's own guidance: their Execute Order
  // page checks `status === "Success"` and treats everything else as a failed
  // swap, adding that "if there is no status, the order likely expired (did
  // not get processed onchain and failed)". Passing those through answered
  // 200 with an undefined status and signature, which the wallet renders as a
  // failed swap with no reason at all.
  if (data.status !== 'Success') {
    console.warn(`Transaction execution did not succeed: ${data.status} / ${data.error}`);
    throw buildExecutionFailedError(data);
  }

  return data;
};

/**
 * Create swap order from Jupiter Ultra API v1
 * Ultra API combines quote + transaction generation in a single call
 *
 * @param {Object} params - Order parameters
 * @param {string} params.amount - Amount in smallest unit (lamports/smallest token unit)
 * @param {string} params.inputMint - Input token mint address
 * @param {string} params.outputMint - Output token mint address
 * @param {string} params.publicKey - User's wallet public key (taker)
 * @param {Object} locals - Request locals
 * @returns {Promise<Object|null>} Order object with {transaction, requestId, outAmount, ...} or null
 *
 * Slippage is not a parameter: Jupiter Ultra computes and applies it
 * server-side and reports the result back as `slippageBps` on the order.
 */
const order = async ({ amount, inputMint, outputMint, publicKey }, _locals) => {
  await rateLimiter.waitAndConsume();

  return withRetry(
    async () => {
      const url = `${JUPITER_SWAP_URL}/order`;
      const params = {
        inputMint,
        outputMint,
        amount,
        taker: publicKey,
        ...getReferralParams(),
      };

      const config = {
        timeout: ORDER_TIMEOUT,
        headers: buildHeaders(),
        params,
      };

      try {
        const { data } = await http.get(url, config);
        return getOrderResult(data);
      } catch (error) {
        const status = error.response?.status;
        logOrderError(error, url, params);

        if (status === 400) {
          console.warn(`Invalid request (400): ${error.response?.data?.error || 'Bad request'}`);
          return null;
        }

        throw error;
      }
    },
    {
      maxRetries: 3,
      initialDelay: 1000,
      operationName: `Jupiter Ultra Order (${inputMint} → ${outputMint})`,
    }
  );
};

/**
 * Execute signed swap transaction via Jupiter Ultra API v1
 * Ultra API handles transaction broadcasting automatically
 *
 * @param {Object} params - Execute parameters
 * @param {string} params.signedTransaction - Base64-encoded signed transaction from frontend
 * @param {string} params.requestId - Request ID from order response
 * @param {Object} locals - Request locals
 * @returns {Promise<Object|null>} Execute result with {status, signature, swapEvents, ...} or null
 */
const execute = async ({ signedTransaction, requestId }, _locals) => {
  await rateLimiter.waitAndConsume();

  return withRetry(
    async () => {
      const url = `${JUPITER_SWAP_URL}/execute`;
      const payload = {
        signedTransaction,
        requestId,
      };

      const config = {
        timeout: EXECUTE_TIMEOUT,
        headers: buildHeaders({
          'Content-Type': 'application/json',
        }),
      };

      const { data } = await http.post(url, payload, config);
      return getExecuteResult(data);
    },
    {
      maxRetries: 2,
      initialDelay: 2000,
      operationName: `Jupiter Ultra Execute (requestId: ${requestId?.substring(0, 8)}...)`,
    }
  );
};

/**
 * Resolve the smallest-unit `amount` Jupiter expects from either a raw
 * `amount` (passthrough) or a human-readable `uiAmount`. When `uiAmount`
 * is provided, decimals are looked up server-side from the Jupiter v2
 * token catalog so clients no longer need a separate token-list fetch
 * before requesting a quote. SOL native (`SOL_ADDRESS`) short-circuits
 * to 9 decimals so a swap from native SOL works even when the mint is
 * not yet warm in the catalog cache.
 *
 * @returns `{ amount }` on success, `{ error, error_description }` on
 *   malformed input / unknown mint. Controllers translate the error
 *   shape into a 400 response.
 */
const resolveOrderAmount = async ({ amount, uiAmount, inputMint }, locals) => {
  if (amount) {
    // A raw amount used to be forwarded on truthiness alone, so '0' and '-5'
    // reached Jupiter, came back as "Invalid taker/amount" and were reported
    // to the caller as 404 "no route available" — the wrong diagnosis for a
    // bad parameter, and an upstream call spent to get it.
    const numeric = Number(amount);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      return {
        error: 'invalid_parameter',
        error_description: 'amount must be a positive integer in the token smallest unit',
      };
    }

    return { amount };
  }

  if (!uiAmount) {
    return {
      error: 'missing_parameter',
      error_description: 'Either `amount` (raw) or `uiAmount` (human-readable) is required',
    };
  }

  const numeric = Number(uiAmount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return {
      error: 'invalid_parameter',
      error_description: 'uiAmount must be a positive number',
    };
  }

  let decimals;
  if (inputMint === SOL_ADDRESS) {
    decimals = SOL_DECIMALS;
  } else {
    const tokens = await getByMints([inputMint], locals);
    const token = tokens.find((t) => (t.id || t.address) === inputMint);
    if (!token || typeof token.decimals !== 'number') {
      return {
        error: 'unknown_mint',
        error_description: `Could not resolve decimals for inputMint=${inputMint}`,
      };
    }
    decimals = token.decimals;
  }

  // Math.round avoids 1.5 * 10^9 = 1499999999.9999998 rounding artefacts.
  const raw = Math.round(numeric * Math.pow(10, decimals));
  return { amount: String(raw) };
};

module.exports = { order, execute, resolveOrderAmount };
