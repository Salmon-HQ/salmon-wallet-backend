'use strict';

const OWNER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const DESTINATION = '2DjAJ2r46qmVH2TLUaFQqqJir28Df1LDEBce3rZkFubi';
const ASSET_ID = 'BuNKhNqwMCRufb7Huqe8YtKFsaGj8uUqyKYXKH67pN1Z';

const mockCreateUmi = jest.fn();
const mockCreateNoopSigner = jest.fn();
const mockSignerIdentity = jest.fn();
const mockGetAssetWithProof = jest.fn();
const mockTransferCompressed = jest.fn();
const mockCreateTransactionResponseFromUmiBuilder = jest.fn();
const mockDispatchDasRpc = jest.fn((_method, _environment, run) => run('https://das.example.com'));

jest.mock('@solana/web3.js', () => {
  class MockPublicKey {
    constructor(value) {
      this._v = String(value);
    }
    toBase58() {
      return this._v;
    }
  }
  return { PublicKey: MockPublicKey };
});

jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddressSync: jest.fn(),
}));

jest.mock('@metaplex-foundation/umi', () => ({
  createNoopSigner: (...args) => mockCreateNoopSigner(...args),
  signerIdentity: (...args) => mockSignerIdentity(...args),
}));

jest.mock('@metaplex-foundation/umi-bundle-defaults', () => ({
  createUmi: (...args) => mockCreateUmi(...args),
}));

jest.mock('@metaplex-foundation/mpl-token-metadata', () => ({
  mplTokenMetadata: jest.fn(() => ({ name: 'mplTokenMetadata' })),
}));

jest.mock('@metaplex-foundation/mpl-bubblegum', () => ({
  getAssetWithProof: (...args) => mockGetAssetWithProof(...args),
  mplBubblegum: jest.fn(() => ({ name: 'mplBubblegum' })),
  transfer: (...args) => mockTransferCompressed(...args),
}));

jest.mock('@metaplex-foundation/digital-asset-standard-api', () => ({
  dasApi: jest.fn(() => ({ name: 'dasApi' })),
}));

jest.mock('@metaplex-foundation/umi-web3js-adapters', () => ({
  fromWeb3JsPublicKey: jest.fn((value) => value.toBase58()),
}));

jest.mock('../providers', () => ({
  dispatchDasRpc: (...args) => mockDispatchDasRpc(...args),
}));

jest.mock('../transaction-serialization', () => ({
  createTransactionResponseFromUmiBuilder: (...args) =>
    mockCreateTransactionResponseFromUmiBuilder(...args),
}));

const { transferCompressedNftTransaction } = require('../nft-transfer-service');

const createMockUmi = () => {
  const umi = {
    identity: null,
    payer: null,
    use: jest.fn((plugin) => {
      if (plugin && typeof plugin.install === 'function') {
        plugin.install(umi);
      }
      return umi;
    }),
  };

  return umi;
};

describe('nft-transfer-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCreateNoopSigner.mockImplementation((publicKey) => ({ publicKey }));
    mockSignerIdentity.mockImplementation((signer) => ({
      install(umi) {
        umi.identity = signer;
        umi.payer = signer;
      },
    }));
    mockCreateUmi.mockImplementation(() => createMockUmi());
    mockDispatchDasRpc.mockImplementation((_method, _environment, run) =>
      run('https://das.example.com')
    );
    mockGetAssetWithProof.mockResolvedValue({ leafOwner: OWNER });
    mockTransferCompressed.mockReturnValue({
      setFeePayer: jest.fn().mockReturnThis(),
      useV0: jest.fn().mockReturnThis(),
    });
    mockCreateTransactionResponseFromUmiBuilder.mockResolvedValue({
      transaction: 'transfer-transaction',
    });
  });

  test('routes the compressed asset proof lookup through the provider resolver', async () => {
    const result = await transferCompressedNftTransaction(ASSET_ID, OWNER, DESTINATION, {
      network: {
        environment: 'devnet',
        config: { nodeUrl: 'https://rpc.example.com' },
      },
    });

    expect(mockDispatchDasRpc).toHaveBeenCalledWith(
      'getAssetWithProof',
      'devnet',
      expect.any(Function)
    );
    // The proof lookup runs against the URL the resolver picked, not locals.nodeUrl.
    expect(mockCreateUmi).toHaveBeenCalledWith('https://das.example.com');
    expect(result).toEqual({ transaction: 'transfer-transaction' });
  });
});
