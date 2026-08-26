'use strict';

const service = require('../../services/shared/network-catalog-service');
const resource = require('../../resources/shared/network-resource');

/**
 * Lists supported networks for the current stage.
 *
 * @param {import('express').Request} req - Unused; the network list is stage-derived.
 * @param {import('express').Response} res - Responds 200 with the array of network
 *   resources (see `network-catalog` spec for shape/enabled/sections rules).
 * @returns {void}
 */
const list = (req, res) => {
  res.status(200).send(service.list().map(resource));
};

module.exports = { list };
