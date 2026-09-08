'use strict';

/**
 * Hermetic integration test for the bare-RPC history path against a LOCAL
 * validator, exercising a real version 1 (SIMD-0296) transaction end to end:
 * build + send with @solana/kit → `getSignaturesForAddress` +
 * `getParsedTransaction` through `@solana/web3.js` (the fallback path) →
 * parser → `_source: 'rpc-standard'` item.
 *
 * This is the only place the web3.js pin (`1.99.0-beta.0`) is proven against
 * an actual v1 response rather than a fixture: 1.98 rejects `version: 1` at
 * its response schema, and a mocked `Connection` cannot show that.
 *
 * Needs `solana-test-validator` (Agave ≥ 4.2, v1 feature is active by
 * default) listening on `SOLANA_LOCAL_RPC_URL` (default
 * http://127.0.0.1:8899). Skips when no validator answers; no secrets, no
 * external network. Run with `npm run test:integration:local-validator`.
 */

const http = require('node:http');
const {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  lamports,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} = require('@solana/kit');

// The enrichment step reads token catalogs and NFT metadata from external
// services; the subject here is the RPC read + parse, so it is stubbed.
jest.mock('../solana-rpc-enrichment', () => ({
  loadRpcEnrichment: jest.fn().mockResolvedValue(undefined),
}));
// A configured TRITON_RPC_URL in .env makes the resolver treat every
// environment as enhanced-capable and try Triton first; this suite is about
// the bare-RPC fallback, so the gate is pinned closed.
jest.mock('../providers', () => ({
  ...jest.requireActual('../providers'),
  isEnhancedApiSupported: () => false,
}));

const transactionService = require('../solana-transaction-service');

const RPC_URL = process.env.SOLANA_LOCAL_RPC_URL || 'http://127.0.0.1:8899';
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// ~1.3 KB of memo: past the 1232-byte legacy limit, so only v1 can carry it.
const MEMO = 'salmon-v1-local-'.repeat(80);

jest.setTimeout(120000);

afterAll(() => {
  http.globalAgent.destroy();
});

const probeValidator = async () => {
  try {
    const health = await createSolanaRpc(RPC_URL).getHealth().send();
    return health === 'ok';
  } catch {
    return false;
  }
};

/** SPL Memo instruction (bundled with solana-test-validator). */
const memoInstruction = (text) => ({
  programAddress: MEMO_PROGRAM,
  accounts: [],
  data: Buffer.from(text, 'utf8'),
});

/** System-program `Transfer` (index 2) without pulling in @solana-program/system. */
const transferInstruction = (signer, destination, amount) => {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, BigInt(amount), true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: signer.address, role: 3 /* WRITABLE_SIGNER */, signer },
      { address: destination, role: 1 /* WRITABLE */ },
    ],
    data,
  };
};

const sendV1Transaction = async (rpc, payer, destination) => {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [transferInstruction(payer, destination, 10_000_000), memoInstruction(MEMO)],
        m
      ),
    // v1 budgets zero compute units and zero loaded-account bytes when unset;
    // the Memo program account alone is over 64 KiB and a 1.3 KB memo burns
    // ~450k CU (measured), so both are sized for what this transaction does.
    (m) =>
      setTransactionMessageConfig(
        {
          computeUnitLimit: 1400000,
          loadedAccountsDataSizeLimit: 262144,
          priorityFeeLamports: 500n,
        },
        m
      )
  );
  const signed = await signTransactionMessageWithSigners(message);
  const wire = getBase64EncodedWireTransaction(signed);
  const wireBytes = Buffer.from(wire, 'base64');
  const signature = await rpc
    .sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' })
    .send();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      if (status.err) throw new Error(`v1 transaction failed: ${JSON.stringify(status.err)}`);
      return { signature, wireBytes };
    }
  }
  throw new Error('v1 transaction was not confirmed in time');
};

describe('bare-RPC history path against a local validator (v1 transactions)', () => {
  let validatorReachable = false;

  beforeAll(async () => {
    validatorReachable = await probeValidator();
    if (!validatorReachable) {
      console.warn(`[local-validator] no validator at ${RPC_URL} — skipping`);
    }
  });

  it('reads a real v1 transaction through getParsedTransaction on web3.js and parses it', async () => {
    if (!validatorReachable) return;

    const rpc = createSolanaRpc(RPC_URL);
    const payer = await generateKeyPairSigner();
    const destination = (await generateKeyPairSigner()).address;
    const airdrop = await rpc.requestAirdrop(payer.address, lamports(1_000_000_000n)).send();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const { value } = await rpc.getSignatureStatuses([airdrop]).send();
      if (value[0]?.confirmationStatus) break;
    }

    const { signature, wireBytes } = await sendV1Transaction(rpc, payer, destination);
    expect(wireBytes[0]).toBe(0x81);
    expect(wireBytes.length).toBeGreaterThan(1232);

    const locals = {
      network: {
        id: 'solana-localnet',
        environment: 'localnet', // not an enhanced-API environment → bare-RPC path
        config: { nodeUrl: RPC_URL },
      },
    };
    const result = await transactionService.getTransactions(payer.address, { pageSize: 5 }, locals);

    expect(result.data).toHaveLength(2); // airdrop + the v1 transfer
    const v1 = result.data.find((item) => item.signature === signature);
    expect(v1).toBeDefined();
    expect(v1._source).toBe('rpc-standard');
    expect(v1.version).toBe(1);
    expect(v1.meta.err).toBeNull();
    expect(v1.transaction.message.transactionConfig).toMatchObject({
      computeUnitLimit: 1400000,
      loadedAccountsDataSizeLimit: 262144,
      priorityFee: 500,
    });
    expect(v1.transaction.message.instructions).toHaveLength(2);
    // Base fee for one signature plus the total priority fee from the config.
    expect(v1.meta.fee).toBe(5000 + 500);
  });
});
