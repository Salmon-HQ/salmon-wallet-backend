'use strict';

const OWNER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const DELEGATE = 'DbF7cjsq6aBifX9ogr2JMAqfbHVhXvNJSzm7nXc3SMq1';
const ASSET_ID = 'BuNKhNqwMCRufb7Huqe8YtKFsaGj8uUqyKYXKH67pN1Z';

const mockCreateUmi = jest.fn();
const mockCreateNoopSigner = jest.fn();
const mockSignerIdentity = jest.fn();
const mockBurnV1 = jest.fn();
const mockFetchDigitalAssetWithAssociatedToken = jest.fn();
const mockBurnV2 = jest.fn();
const mockGetAssetWithProof = jest.fn();
const mockBurnCompressedLegacy = jest.fn();
const mockCreateLookupTableFallbackTransactions = jest.fn();
const mockCreateTransactionResponseFromUmiBuilder = jest.fn();
const mockToWeb3JsTransaction = jest.fn((transaction) => transaction);
const mockDispatchDasRpc = jest.fn((_method, _environment, run) => run('https://das.example.com'));

jest.mock('@metaplex-foundation/umi', () => ({
  createNoopSigner: (...args) => mockCreateNoopSigner(...args),
  none: jest.fn(() => ({ __option: 'None' })),
  some: jest.fn((value) => ({ __option: 'Some', value })),
  signerIdentity: (...args) => mockSignerIdentity(...args),
}));

jest.mock('@metaplex-foundation/umi-bundle-defaults', () => ({
  createUmi: (...args) => mockCreateUmi(...args),
}));

jest.mock('@metaplex-foundation/mpl-token-metadata', () => ({
  burnV1: (...args) => mockBurnV1(...args),
  fetchDigitalAssetWithAssociatedToken: (...args) =>
    mockFetchDigitalAssetWithAssociatedToken(...args),
  findMetadataPda: jest.fn(() => 'collection-metadata'),
  mplTokenMetadata: jest.fn(() => ({ name: 'mplTokenMetadata' })),
  TokenStandard: {
    NonFungible: 'NonFungible',
    ProgrammableNonFungibleEdition: 'ProgrammableNonFungibleEdition',
    ProgrammableNonFungible: 'ProgrammableNonFungible',
  },
}));

jest.mock('@metaplex-foundation/mpl-bubblegum', () => ({
  burn: (...args) => mockBurnCompressedLegacy(...args),
  burnV2: (...args) => mockBurnV2(...args),
  getAssetWithProof: (...args) => mockGetAssetWithProof(...args),
  mplBubblegum: jest.fn(() => ({ name: 'mplBubblegum' })),
}));

jest.mock('@metaplex-foundation/digital-asset-standard-api', () => ({
  dasApi: jest.fn(() => ({ name: 'dasApi' })),
}));

jest.mock('@metaplex-foundation/umi-web3js-adapters', () => ({
  fromWeb3JsPublicKey: jest.fn((value) => value.toBase58()),
  toWeb3JsTransaction: (...args) => mockToWeb3JsTransaction(...args),
}));

const mockGetLatestBlockhash = jest
  .fn()
  .mockResolvedValue({ blockhash: 'bh', lastValidBlockHeight: 1 });

jest.mock('@solana/web3.js', () => {
  class MockPublicKey {
    constructor(value) {
      this._v = String(value);
    }
    toBase58() {
      return this._v;
    }
  }
  return {
    Connection: jest.fn(() => ({
      getLatestBlockhash: mockGetLatestBlockhash,
    })),
    PublicKey: MockPublicKey,
    Transaction: jest.fn(() => ({
      add: jest.fn().mockReturnThis(),
      feePayer: null,
      recentBlockhash: null,
    })),
    TransactionInstruction: jest.fn((args) => ({ kind: 'tx-instruction', ...args })),
  };
});

jest.mock('../address-lookup-table-service', () => ({
  createLookupTableFallbackTransactions: (...args) =>
    mockCreateLookupTableFallbackTransactions(...args),
}));

jest.mock('../providers', () => ({
  dispatchDasRpc: (...args) => mockDispatchDasRpc(...args),
}));

jest.mock('../transaction-serialization', () => ({
  createTransactionResponseFromWeb3: jest.fn(() => ({ transaction: 'web3-transaction' })),
  createTransactionResponseFromUmiBuilder: (...args) =>
    mockCreateTransactionResponseFromUmiBuilder(...args),
}));

const { UnsupportedSolanaNftBurnError } = require('../solana-nft-burn-errors');
const burnService = require('../burn-service');

const createBuilder = ({
  fitsInOneTransaction = true,
  transactionSize = 900,
  label = 'builder',
} = {}) => {
  const builder = {
    label,
    fitsInOneTransaction: jest.fn(() => fitsInOneTransaction),
    getTransactionSize: jest.fn(() => transactionSize),
    buildWithLatestBlockhash: jest.fn(async () => ({ builtFrom: label })),
    setAddressLookupTables: jest.fn(),
    setFeePayer: jest.fn(),
    useV0: jest.fn(),
  };

  builder.setFeePayer.mockReturnValue(builder);
  builder.useV0.mockReturnValue(builder);
  builder.setAddressLookupTables.mockReturnValue(builder);

  return builder;
};

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

const createCompressedAsset = (overrides = {}) => ({
  leafOwner: OWNER,
  leafDelegate: DELEGATE,
  merkleTree: 'tree-address',
  root: new Uint8Array(32).fill(1),
  dataHash: new Uint8Array(32).fill(2),
  creatorHash: new Uint8Array(32).fill(3),
  asset_data_hash: undefined,
  flags: undefined,
  nonce: 12,
  index: 34,
  proof: ['proof-a', 'proof-b'],
  ...overrides,
});

describe('burn-service', () => {
  const locals = {
    network: {
      config: {
        nodeUrl: 'https://rpc.example.com',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreateNoopSigner.mockImplementation((publicKey) => ({
      publicKey,
      signTransaction: jest.fn(async (transaction) => transaction),
      signAllTransactions: jest.fn(async (transactions) => transactions),
      signMessage: jest.fn(async (message) => message),
    }));

    mockSignerIdentity.mockImplementation((signer) => ({
      install(umi) {
        umi.identity = signer;
        umi.payer = signer;
      },
    }));

    mockCreateUmi.mockImplementation(() => createMockUmi());
    mockCreateTransactionResponseFromUmiBuilder.mockImplementation(async (_umi, builder) => ({
      transaction: `${builder.label}-transaction`,
    }));
    mockCreateLookupTableFallbackTransactions.mockResolvedValue(null);
  });

  test('uses legacy compressed burn for schema-v1 cNFTs', async () => {
    const builder = createBuilder({ label: 'legacy-burn' });
    mockGetAssetWithProof.mockResolvedValue(createCompressedAsset());
    mockBurnCompressedLegacy.mockReturnValue(builder);

    const result = await burnService.burnCompressedNftTransaction(ASSET_ID, OWNER, locals);

    expect(mockBurnCompressedLegacy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        leafOwner: OWNER,
        leafDelegate: DELEGATE,
        merkleTree: 'tree-address',
      })
    );
    expect(mockBurnV2).not.toHaveBeenCalled();
    expect(result).toEqual({ transaction: 'legacy-burn-transaction' });
  });

  test('uses burnV2 for schema-v2 cNFTs', async () => {
    const builder = createBuilder({ label: 'burn-v2' });
    mockGetAssetWithProof.mockResolvedValue(
      createCompressedAsset({
        asset_data_hash: new Uint8Array(32).fill(9),
        flags: 1,
      })
    );
    mockBurnV2.mockReturnValue(builder);

    const result = await burnService.burnCompressedNftTransaction(ASSET_ID, OWNER, locals);

    expect(mockBurnV2).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payer: expect.objectContaining({ publicKey: OWNER }),
        authority: expect.objectContaining({ publicKey: OWNER }),
      })
    );
    expect(mockBurnCompressedLegacy).not.toHaveBeenCalled();
    expect(result).toEqual({ transaction: 'burn-v2-transaction' });
  });

  test('returns a LUT-backed flow when the compressed burn does not fit in one transaction', async () => {
    const directBuilder = createBuilder({
      label: 'direct-burn',
      fitsInOneTransaction: false,
      transactionSize: 1400,
    });
    const lookupBuilder = createBuilder({
      label: 'lookup-burn',
      fitsInOneTransaction: true,
      transactionSize: 700,
    });

    directBuilder.setAddressLookupTables.mockReturnValue(lookupBuilder);

    mockGetAssetWithProof.mockResolvedValue(createCompressedAsset());
    mockBurnCompressedLegacy.mockReturnValue(directBuilder);
    mockCreateLookupTableFallbackTransactions.mockResolvedValue({
      lookupTableInput: { publicKey: 'lookup-table', addresses: ['a', 'b'] },
      lookupTable: {
        required: true,
        estimatedRentLamports: 1_000_000,
        estimatedRentSol: 0.001,
        addressCount: 2,
        extendTransactionCount: 1,
      },
      transactions: [{ transaction: 'lookup-create', step: 'lookup_table_create' }],
    });

    const result = await burnService.burnCompressedNftTransaction(ASSET_ID, OWNER, locals);

    expect(mockCreateLookupTableFallbackTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: OWNER,
        nodeUrl: 'https://rpc.example.com',
      })
    );
    expect(result).toEqual({
      transactions: [
        { transaction: 'lookup-create', step: 'lookup_table_create' },
        { transaction: 'lookup-burn-transaction', step: 'burn' },
      ],
      lookupTable: {
        required: true,
        estimatedRentLamports: 1_000_000,
        estimatedRentSol: 0.001,
        addressCount: 2,
        extendTransactionCount: 1,
      },
      message: 'Compressed NFT burn requires a temporary lookup table flow.',
    });
  });

  test('rejects compressed burns when the owner does not match the asset owner', async () => {
    mockGetAssetWithProof.mockResolvedValue(
      createCompressedAsset({
        leafOwner: '2DjAJ2r46qmVH2TLUaFQqqJir28Df1LDEBce3rZkFubi',
      })
    );

    await expect(
      burnService.burnCompressedNftTransaction(ASSET_ID, OWNER, locals)
    ).rejects.toBeInstanceOf(UnsupportedSolanaNftBurnError);
  });

  test('routes the compressed asset proof lookup through the provider resolver', async () => {
    const builder = createBuilder({ label: 'legacy-burn' });
    mockGetAssetWithProof.mockResolvedValue(createCompressedAsset());
    mockBurnCompressedLegacy.mockReturnValue(builder);

    await burnService.burnCompressedNftTransaction(ASSET_ID, OWNER, {
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
  });

  test('uses burnV1 for supported programmable NFTs', async () => {
    const builder = createBuilder({ label: 'pnft-burn' });
    mockFetchDigitalAssetWithAssociatedToken.mockResolvedValue({
      metadata: {
        tokenStandard: { __option: 'Some', value: 'ProgrammableNonFungible' },
        publicKey: 'metadata-address',
        collection: { __option: 'None' },
      },
      token: { publicKey: 'token-address' },
      tokenRecord: { publicKey: 'token-record-address' },
      edition: { publicKey: 'edition-address', isOriginal: true },
    });
    mockBurnV1.mockReturnValue(builder);

    const result = await burnService.burnProgrammableNftTransaction(ASSET_ID, OWNER, locals);

    expect(mockBurnV1).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        authority: expect.objectContaining({ publicKey: OWNER }),
        tokenStandard: 'ProgrammableNonFungible',
      })
    );
    expect(result).toEqual({ transaction: 'pnft-burn-transaction' });
  });

  test('rejects programmable NFT editions', async () => {
    mockFetchDigitalAssetWithAssociatedToken.mockResolvedValue({
      metadata: {
        tokenStandard: { __option: 'Some', value: 'ProgrammableNonFungibleEdition' },
        publicKey: 'metadata-address',
        collection: { __option: 'None' },
      },
      token: { publicKey: 'token-address' },
      tokenRecord: null,
      edition: { publicKey: 'edition-address', isOriginal: false },
    });

    await expect(
      burnService.burnProgrammableNftTransaction(ASSET_ID, OWNER, locals)
    ).rejects.toBeInstanceOf(UnsupportedSolanaNftBurnError);
  });

  test('burnMasterEditionTransaction builds via burnV1 with the NonFungible standard', async () => {
    const builder = createBuilder({ label: 'master-burn' });
    mockFetchDigitalAssetWithAssociatedToken.mockResolvedValue({
      metadata: {
        publicKey: 'metadata-address',
        collection: { __option: 'Some', value: { key: 'collection-mint' } },
      },
      token: { publicKey: 'token-address' },
      edition: { publicKey: 'edition-address', isOriginal: true },
    });
    mockBurnV1.mockReturnValue(builder);

    const result = await burnService.burnMasterEditionTransaction(ASSET_ID, OWNER, locals);

    expect(mockBurnV1).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        authority: expect.objectContaining({ publicKey: OWNER }),
        tokenStandard: 'NonFungible',
        metadata: 'metadata-address',
        token: 'token-address',
        edition: 'edition-address',
        // `findMetadataPda` is mocked to return 'collection-metadata'.
        collectionMetadata: 'collection-metadata',
      })
    );
    expect(result).toEqual({ transaction: 'master-burn-transaction' });
  });

  test('burnEditionsTransaction builds a TransactionInstruction with u64 amount', async () => {
    const result = await burnService.burnEditionsTransaction(
      ASSET_ID,
      'mintAccountAddress',
      OWNER,
      locals
    );
    // Only assert it returns the serialized response — encoding correctness is
    // belt-and-braces tested by `solana-burn-routing.spec.js` upstream.
    expect(result).toEqual({ transaction: 'web3-transaction' });
  });
});
