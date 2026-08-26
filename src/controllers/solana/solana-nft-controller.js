'use strict';

const { decorator } = require('../../../packages/api-utils');
const { findInvalidAddressParam } = require('../../utils/solana-address');
const service = require('../../services/solana/solana-nft-service');
const decorateToken = require('../../resources/solana/solana-nft-resource');
const { SolanaNftBurnError } = require('../../services/solana/solana-nft-burn-errors');
const { SolanaNftTransferError } = require('../../services/solana/nft-transfer-errors');

const isTruthyQueryFlag = (raw) => raw === 'true' || raw === '1' || raw === true;

/**
 * Lists NFTs owned by a public key. See `solana-nft-listing` spec.
 *
 * @param {import('express').Request} req - Reads `query.publicKey` (required owner
 *   address) and `query.includeSpam` (truthy string/boolean; when not set, blacklisted
 *   or positively-spam-scored NFTs are dropped) and `query.debug` (truthy; adds
 *   `metadataResolved` + `collectionVerified` next to the always-present
 *   `spamScore` / `spamReasons` on each returned item). Remaining query params are
 *   passed through to `service.list`.
 * @param {import('express').Response} res - Responds 200 with
 *   `{ data, pagination }` where `pagination.hidden = { spam, fungible }` counts the
 *   items dropped from this page; 400 with `{ error: 'bad_request', error_description }`
 *   when `publicKey` is missing; 404 with `{ error: 'nfts_not_found',
 *   error_description }` when the service returns no result.
 * @returns {Promise<void>}
 */
/**
 * Responds 400 when any supplied address parameter is not valid base58.
 * @param {import('express').Response} res
 * @param {Object<string, unknown>} params
 * @returns {boolean} true when a response was sent.
 */
const rejectInvalidAddresses = (res, params) => {
  const invalid = findInvalidAddressParam(params);
  if (!invalid) return false;

  res.status(400).json({
    error: 'bad_request',
    error_description: `${invalid} is not a valid Solana address.`,
  });
  return true;
};

/**
 * `?debug=1` annotates each surviving item with the inputs the spam detector
 * saw but the public shape does not carry. Reads the provider-normalized asset
 * by index: the decorator preserves order (fungible mints become `null`).
 */
const withDebugFields = (decorated, rawNfts) =>
  decorated.map((nft, i) =>
    nft
      ? {
          ...nft,
          metadataResolved: rawNfts[i]?.metadataResolved !== false,
          collectionVerified: rawNfts[i]?.collection?.verified ?? null,
        }
      : nft
  );

const list = async (req, res) => {
  const { publicKey, includeSpam, debug } = req.query;
  if (!publicKey) {
    return res.status(400).json({
      error: 'bad_request',
      error_description: 'publicKey query parameter is required.',
    });
  }

  if (rejectInvalidAddresses(res, { publicKey })) return undefined;

  const result = await service.list(req.query, res.locals);
  if (result && result.data) {
    const include = { blacklisted: {} };
    let decorated = await decorator(decorateToken, result.data, { res, include });
    if (isTruthyQueryFlag(debug)) decorated = withDebugFields(decorated, result.data);
    // Spam/fungible filtering policy lives in the service; the controller
    // only translates the query flag.
    const { data, hidden } = service.filterSpam(decorated, isTruthyQueryFlag(includeSpam));
    res.status(200).send({
      data,
      pagination: { ...result.pagination, hidden },
    });
  } else {
    res.status(404).json({
      error: 'nfts_not_found',
      error_description: `NFTs not found`,
    });
  }
};

/**
 * Builds a burn transaction for an NFT, routing on token standard (cNFT v1/v2,
 * pNFT, edition, master). See `solana-nft-burn` spec.
 *
 * @param {import('express').Request} req - Reads `params.mintAddress` and
 *   `query.owner` (required, the NFT owner's public key).
 * @param {import('express').Response} res - Responds 200 with the unsigned burn
 *   transaction payload; 400 with `{ error: 'bad_request', error_description }` when
 *   `owner` is missing; 500 with `{ error: 'burn_transaction', error_description }`
 *   when the service returns no data; on `SolanaNftBurnError`, responds with the
 *   error's own `statusCode`/`errorCode`/`message`.
 * @returns {Promise<void>}
 * @throws Re-throws any error that is not a `SolanaNftBurnError`, so the global
 *   error handler produces the response.
 */
const burnTransaction = async (req, res) => {
  const { mintAddress } = req.params;
  const { owner } = req.query;
  if (!owner) {
    return res.status(400).json({
      error: 'bad_request',
      error_description: 'owner query parameter is required.',
    });
  }

  if (rejectInvalidAddresses(res, { owner, mintAddress })) return undefined;

  try {
    const data = await service.createBurnTransaction(mintAddress, owner, res.locals);
    if (data) {
      return res.status(200).send(data);
    }

    return res.status(500).json({
      error: 'burn_transaction',
      error_description: 'Unknown error trying to create burn transaction.',
    });
  } catch (error) {
    if (error instanceof SolanaNftBurnError) {
      return res.status(error.statusCode).json({
        error: error.errorCode,
        error_description: error.message,
      });
    }

    throw error;
  }
};

/**
 * POST /v1/:network/nft/:mintAddress/transfer?owner=&destination=
 *
 * Returns an unsigned transfer transaction for the client to sign. Built with
 * Token Metadata's `transferV1` (or Bubblegum for compressed assets) so that
 * programmable NFTs work — a plain SPL transfer fails on those with
 * `Account is frozen`.
 */
const transferTransaction = async (req, res) => {
  const { mintAddress } = req.params;
  const { owner, destination } = req.query;

  if (!owner || !destination) {
    return res.status(400).json({
      error: 'bad_request',
      error_description: 'owner and destination query parameters are required.',
    });
  }

  if (rejectInvalidAddresses(res, { owner, destination, mintAddress })) return undefined;

  try {
    const data = await service.createTransferTransaction(
      mintAddress,
      owner,
      destination,
      res.locals
    );
    if (data) {
      return res.status(200).send(data);
    }

    return res.status(500).json({
      error: 'transfer_transaction',
      error_description: 'Unknown error trying to create transfer transaction.',
    });
  } catch (error) {
    if (error instanceof SolanaNftTransferError) {
      return res.status(error.statusCode).json({
        error: error.errorCode,
        error_description: error.message,
      });
    }

    throw error;
  }
};

module.exports = {
  list,
  burnTransaction,
  transferTransaction,
};
