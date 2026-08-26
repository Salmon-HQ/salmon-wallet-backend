'use strict';

/**
 * Differential coverage for the master-edition burn transaction.
 *
 * The master-edition path is built with Umi's `burnV1`. It used to be built
 * with the deprecated `@metaplex-foundation/js` `nfts().builders().delete()`
 * helper. Both emit the same Token Metadata `Burn` instruction (discriminator
 * 41, `BurnArgs::V1 { amount: 1 }`) with the same 14 accounts, so with the same
 * pinned inputs they serialize to the same transaction. `GOLDEN_BURN_TRANSACTION`
 * is that transaction, captured from the deprecated builder before the swap.
 *
 * Everything here runs offline: the blockhash is pinned, the account fetch is
 * stubbed, and every address is derived from the pinned mint and owner.
 */

const OWNER = '9mpJyg7iEse9rPMP1tdiSdSAYbLJX6nJyGbNkbT3SAd3';
const MINT = 'BuNKhNqwMCRufb7Huqe8YtKFsaGj8uUqyKYXKH67pN1Z';
const COLLECTION_MINT = 'DbF7cjsq6aBifX9ogr2JMAqfbHVhXvNJSzm7nXc3SMq1';
const COLLECTION_METADATA = 'BwPvQGV7L9pXWXPPcy5c8WyrrmVMc5jBDEiqkksbkqar';
const NODE_URL = 'https://rpc.example.com';
const TOKEN_METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const BURN_V1_DATA_HEX = '29000100000000000000';

// Captured from `@metaplex-foundation/js`'s `nfts().builders().delete()` before
// that dependency was removed, with the inputs pinned above. It is the exact
// transaction this endpoint returned in production prior to the Umi swap.
const GOLDEN_BURN_TRANSACTION =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAECYJYi2cazW/XXS5wezndycuVSeNsR4NA6aEaNdv45qW24kCU3k8VDk0w6rajXM48BJ2r/bSKzRZSgh8VpqF7OCuCLQZF1mJQL1OCbdCmunT8/RvMuomPbTA2do74+fzwm6H/LjstfeUMb13KZDY7YaBBgwbjPrfLS1cnrRS9/MjsVf9ybOUu2l2NkTKbjNnjOS0UM90HtA1eQxDLJLdKSd0LcGWx49F8RTidUn9rBMPNWLhscxqg/bVJttG8A/gpRgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABqfVFxh70WY12tQEVf3CwMEkxo8hVnWl27rLXwgAAAAG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqcSa53YDeCBU8Xqd7OpDtETroO2xLG8dMcbg5KhL8FLrAQUOAAUBAgMEBQUFBQUGBwgKKQABAAAAAAAAAAA=';

jest.mock('@metaplex-foundation/umi-bundle-defaults', () => {
  const actual = jest.requireActual('@metaplex-foundation/umi-bundle-defaults');
  return {
    ...actual,
    createUmi: (endpoint) => {
      const umi = actual.createUmi(endpoint);
      // Pin the blockhash so the built transaction is deterministic offline.
      umi.rpc = {
        ...umi.rpc,
        getLatestBlockhash: async () => ({
          blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k',
          lastValidBlockHeight: 1,
        }),
      };
      return umi;
    },
  };
});

jest.mock('@metaplex-foundation/mpl-token-metadata', () => ({
  ...jest.requireActual('@metaplex-foundation/mpl-token-metadata'),
  fetchDigitalAssetWithAssociatedToken: jest.fn(),
}));

const { PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const { none, some } = require('@metaplex-foundation/umi');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const {
  fetchDigitalAssetWithAssociatedToken,
  findMasterEditionPda,
  findMetadataPda,
  mplTokenMetadata,
} = require('@metaplex-foundation/mpl-token-metadata');
const { fromWeb3JsPublicKey } = require('@metaplex-foundation/umi-web3js-adapters');
const burnService = require('../burn-service');

// A throwaway Umi used only to derive the PDAs the stubbed account fetch returns.
const referenceUmi = createUmi(NODE_URL).use(mplTokenMetadata());
const mintPublicKey = fromWeb3JsPublicKey(new PublicKey(MINT));

const METADATA_PDA = findMetadataPda(referenceUmi, { mint: mintPublicKey });
const MASTER_EDITION_PDA = findMasterEditionPda(referenceUmi, { mint: mintPublicKey });
const OWNER_ATA = fromWeb3JsPublicKey(
  getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(OWNER), true)
);

const locals = { network: { config: { nodeUrl: NODE_URL } } };

/** The on-chain asset the RPC would return, with `collection` swappable. */
const digitalAsset = (collection) => ({
  metadata: { publicKey: METADATA_PDA, collection },
  edition: { publicKey: MASTER_EDITION_PDA, isOriginal: true },
  token: { publicKey: OWNER_ATA },
});

/** Decode the single instruction of a serialized v0 transaction. */
const decodeBurnInstruction = (base64) => {
  const { message } = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  const keys = message.staticAccountKeys;
  const [instruction] = message.compiledInstructions;

  return {
    programId: keys[instruction.programIdIndex].toBase58(),
    accounts: instruction.accountKeyIndexes.map(
      (index) =>
        `${keys[index].toBase58()} signer=${message.isAccountSigner(index)} writable=${message.isAccountWritable(index)}`
    ),
    data: Buffer.from(instruction.data).toString('hex'),
  };
};

describe('master-edition burn transaction', () => {
  beforeEach(() => {
    fetchDigitalAssetWithAssociatedToken.mockResolvedValue(digitalAsset(none()));
  });

  test('burnMasterEditionTransaction produces the golden transaction', async () => {
    const result = await burnService.burnMasterEditionTransaction(MINT, OWNER, locals);

    expect(result.transaction).toBe(GOLDEN_BURN_TRANSACTION);
  });

  test('the golden transaction carries the Token Metadata Burn instruction', () => {
    const golden = decodeBurnInstruction(GOLDEN_BURN_TRANSACTION);

    expect(golden.programId).toBe(TOKEN_METADATA_PROGRAM);
    expect(golden.data).toBe(BURN_V1_DATA_HEX);
    expect(golden.accounts).toHaveLength(14);
    expect(golden.accounts[0]).toBe(`${OWNER} signer=true writable=true`);
    // Slot 1 is the optional collection metadata; absent means "program id".
    expect(golden.accounts[1]).toBe(`${TOKEN_METADATA_PROGRAM} signer=false writable=false`);
  });

  test('adds the collection metadata account for an NFT that belongs to a collection', async () => {
    fetchDigitalAssetWithAssociatedToken.mockResolvedValue(
      digitalAsset(
        some({ key: fromWeb3JsPublicKey(new PublicKey(COLLECTION_MINT)), verified: true })
      )
    );

    const result = await burnService.burnMasterEditionTransaction(MINT, OWNER, locals);

    const golden = decodeBurnInstruction(GOLDEN_BURN_TRANSACTION);
    const actual = decodeBurnInstruction(result.transaction);

    expect(actual.programId).toBe(golden.programId);
    expect(actual.data).toBe(golden.data);
    expect(actual.accounts).toHaveLength(golden.accounts.length);

    // The only intended difference: the collection metadata slot stops being a
    // placeholder and becomes a writable account the Burn handler updates.
    expect(actual.accounts[1]).toBe(`${COLLECTION_METADATA} signer=false writable=true`);
    expect(actual.accounts.filter((_, index) => index !== 1)).toEqual(
      golden.accounts.filter((_, index) => index !== 1)
    );
  });
});
