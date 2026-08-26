'use strict';

const { rethrowAsOwnershipError } = require('../nft-ownership-errors');
const { UnsupportedSolanaNftBurnError } = require('../solana-nft-burn-errors');
const { UnsupportedSolanaNftTransferError } = require('../nft-transfer-errors');

describe('rethrowAsOwnershipError', () => {
  const handle = (ErrorClass, message) => rethrowAsOwnershipError(ErrorClass, message);

  it("turns Umi's missing-token-account failure into a 422 burn error", () => {
    // What fetchDigitalAssetWithAssociatedToken throws when the caller has no
    // ATA for the mint — i.e. they do not own the NFT.
    const umiError = new Error(
      'The account of type [Token] was not found at the provided address [GrDQjXWMVTGKr1RgfQ63J3vdzV3JuDQE78FpoojFN8mr].'
    );

    expect(() =>
      handle(UnsupportedSolanaNftBurnError, 'Only the current owner can burn this NFT.')(umiError)
    ).toThrow(UnsupportedSolanaNftBurnError);
  });

  it('does the same for the transfer route', () => {
    const umiError = new Error(
      'The account of type [Token] was not found at the provided address [x].'
    );

    expect(() =>
      handle(
        UnsupportedSolanaNftTransferError,
        'Only the current owner can transfer this NFT.'
      )(umiError)
    ).toThrow(UnsupportedSolanaNftTransferError);
  });

  it('re-throws anything else untouched, so real faults stay 500', () => {
    const rpcError = new Error('failed to get latest blockhash');

    expect(() => handle(UnsupportedSolanaNftBurnError, 'nope')(rpcError)).toThrow(rpcError);
  });

  it('does not swallow a missing Metadata account, which is a different failure', () => {
    const other = new Error(
      'The account of type [Metadata] was not found at the provided address [x].'
    );

    expect(() => handle(UnsupportedSolanaNftBurnError, 'nope')(other)).toThrow(other);
  });
});
