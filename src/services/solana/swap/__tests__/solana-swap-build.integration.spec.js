'use strict';

/**
 * Nightly: one real 0x build on mainnet for a tiny USDC → SOL amount.
 * Asserts the contract's load-bearing properties (unsigned, taker pays,
 * fee recipient referenced when a fee is configured). NEVER broadcasts.
 * Probe-skips without a working `ZEROEX_API_KEY`.
 */

const axios = require('axios');
const { VersionedTransaction } = require('@solana/web3.js');
const service = require('../solana-swap-build-service');

jest.setTimeout(30000);

const ZEROEX_API_URL = process.env.ZEROEX_API_URL || 'https://api.0x.org/solana';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
// A long-lived, well-funded mainnet wallet; only used as the quoted taker.
const TAKER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const locals = {
  network: {
    id: 'solana-mainnet',
    config: {
      nodeUrl: process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com',
    },
  },
};

const probeZeroex = async () => {
  if (!process.env.ZEROEX_API_KEY) {
    return { ok: false, reason: 'ZEROEX_API_KEY not set' };
  }
  try {
    await axios.get(`${ZEROEX_API_URL}/enabled-sources`, {
      timeout: 5000,
      headers: { '0x-api-key': process.env.ZEROEX_API_KEY },
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.status ? `HTTP ${error.response.status}` : error.message,
    };
  }
};

describe('0x swap build — integration', () => {
  let available = false;

  beforeAll(async () => {
    const result = await probeZeroex();
    available = result.ok;
    if (!available) {
      console.warn(`Skipping 0x integration tests: ${result.reason}`);
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
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(TAKER);
    expect(tx.serialize().length).toBeLessThanOrEqual(1232);
    expect(BigInt(result.amountOut)).toBeGreaterThan(0n);
    expect(BigInt(result.minAmountOut)).toBeLessThanOrEqual(BigInt(result.amountOut));
    expect(result.routePlan.length).toBeGreaterThan(0);
    expect(result.provider.id).toBe('0x');

    if (process.env.SWAP_FEE_BPS && process.env.SWAP_FEE_ACCOUNT_OWNER) {
      expect(result.salmonFee).toMatchObject({ mint: SOL, bps: Number(process.env.SWAP_FEE_BPS) });
      expect(BigInt(result.salmonFee.amount)).toBeGreaterThan(0n);
    } else {
      expect(result.salmonFee).toBeNull();
    }
  });
});
