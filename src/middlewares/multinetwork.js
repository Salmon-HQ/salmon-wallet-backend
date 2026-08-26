'use strict';

const NETWORKS = require('../constants/networks');

/**
 * Express middleware factory that resolves `req.params.networkId` into
 * `res.locals.network` from the network catalog. Skips resolution when
 * `res.locals.network` is already set by an earlier middleware in the
 * chain. When `blockchains` is provided, a resolved network outside that
 * per-mount allowlist is cleared and the request falls through to the next
 * route (`next('route')`) instead of erroring, so sibling chain mounts can
 * still match the same path.
 *
 * @param {object} [options]
 * @param {boolean} [options.required=true] - When true, responds 400 if no
 *   network could be resolved by the end of the middleware.
 * @param {string[]|null} [options.blockchains=null] - Allowlist of
 *   blockchain codes permitted on this mount; `null` allows any chain.
 * @returns {(req: object, res: object, next: Function) => Promise<void>}
 *   Express middleware.
 */
module.exports = ({ required = true, blockchains = null } = {}) => {
  return async (req, res, next) => {
    if (!res.locals.network) {
      const { networkId } = req.params;
      if (networkId) {
        res.locals.network = NETWORKS.find(({ id }) => id === networkId);

        // networkId was provided but did not resolve
        if (!res.locals.network) {
          return res.status(400).send({
            error: 'bad_request',
            error_description: `Invalid network: ${networkId}`,
          });
        }

        // Enforce the per-mount blockchain allowlist
        if (blockchains && !blockchains.includes(res.locals.network.blockchain)) {
          // Resolved chain is not allowed on this mount; fall through
          res.locals.network = undefined;
          return next('route');
        }
      }
    }

    if (required && !res.locals.network) {
      return res.status(400).send({
        error: 'bad_request',
        error_description: 'Network required',
      });
    }

    next();
  };
};
