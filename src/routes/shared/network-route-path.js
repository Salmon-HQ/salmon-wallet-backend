'use strict';

/**
 * Path segment for the multichain `:networkId` route param.
 *
 * Returns the literal Express path token. The resolver populates
 * `res.locals.network` from the matching `NETWORKS` entry; chain
 * filtering for an endpoint is enforced separately by the route's
 * own allowlist (e.g. `BALANCE_CHAINS` in
 * `src/routes/multichain/account-router.js`) plus the
 * `multinetwork({ blockchains })` middleware.
 *
 * Per-chain slice mounts in `src/index.js` use a different mechanism
 * (path-prefixed `/v1/<chain>-:env`) and do NOT call this helper.
 *
 * @returns {string}
 */
const networkPath = () => ':networkId';

module.exports = { networkPath };
