'use strict';

const service = require('../../services/shared/dapp-service');

/**
 * Returns OpenGraph-derived metadata for a dapp URL.
 *
 * @param {import('express').Request} req - Reads `query.url` (the dapp URL to
 *   fetch metadata for).
 * @param {import('express').Response} res - Responds 200 with `{ name, icon }`.
 * @returns {Promise<void>}
 */
const showMetadata = async (req, res) => {
  const data = await service.getMetadata(req.query.url);
  res.status(200).send(data);
};

module.exports = { showMetadata };
