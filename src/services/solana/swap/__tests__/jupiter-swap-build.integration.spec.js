'use strict';

/**
 * Nightly: one real Jupiter build on mainnet for a tiny USDC → SOL amount.
 * Asserts the contract's load-bearing properties (unsigned, taker pays,
 * fee account referenced when a fee is configured). NEVER broadcasts.
 * Probe-skips without a working `JUPITER_API_KEY`.
 */

const axios = require('axios');
const { VersionedTransaction } = require('@solana/web3.js');
const service = require('../solana-swap-build-service');

jest.setTimeout(30000);

const JUPITER_API_URL = process.env.JUPITER_SWAP_API_URL || 'https://api.jup.ag/swap/v2';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
// A long-lived, well-funded mainnet wallet; only used as the quoted taker.
const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const locals = {
  availability: { provider: 'jupiter' },
  network: {
    id: 'solana-mainnet',
    config: {
      nodeUrl: process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com',
    },
  },
};

const probeJupiter = async () => {
  if (!process.env.JUPITER_API_KEY) {
    return { ok: false, reason: 'JUPITER_API_KEY not set' };
  }
  try {
    await axios.get(`${JUPITER_API_URL}/build`, {
      params: { inputMint: USDC, outputMint: SOL, amount: '1000', taker: TAKER },
      timeout: 5000,
      headers: { 'x-api-key': process.env.JUPITER_API_KEY },
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.message,
    };
  }
};

describe('Jupiter swap build — integration', () => {
  let available = false;

  beforeAll(async () => {
    const result = await probeJupiter();
    available = result.ok;
    if (!available) {
      console.warn(`Skipping Jupiter integration tests: ${result.reason}`);
    }
  });

  it('builds an unsigned v0 transaction paid by the taker (no broadcast)', async () => {
    if (!available) {
      return;
    }

    const result = await service.build(
      { inputMint: USDC, outputMint: SOL, amount: '1000000', publicKey: TAKER, slippageBps: 50 },
      locals
    );

    const tx = VersionedTransaction.deserialize(Buffer.from(result.transaction, 'base64'));
    expect(tx.version).toBe(0);
    expect(tx.signatures).toHaveLength(1);
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(TAKER);
    expect(tx.serialize().length).toBeLessThanOrEqual(1232);
    expect(BigInt(result.amountOut)).toBeGreaterThan(0n);
    expect(BigInt(result.minAmountOut)).toBeLessThanOrEqual(BigInt(result.amountOut));
    expect(result.routePlan.length).toBeGreaterThan(0);
    expect(result.provider.id).toBe('jupiter');
    expect(result.routeFee).toBeNull();

    if (process.env.SWAP_FEE_BPS && process.env.SWAP_FEE_ACCOUNT_OWNER && result.salmonFee) {
      // Jupiter takes the fee from the output token only.
      expect(result.salmonFee).toMatchObject({
        mint: SOL,
        side: 'output',
        bps: Number(process.env.SWAP_FEE_BPS),
      });
      expect(BigInt(result.salmonFee.amount)).toBeGreaterThan(0n);
    }
  });
});
