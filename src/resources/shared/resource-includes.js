'use strict';

const scamService = require('../../services/shared/scam-service');
const trustwalletService = require('../../services/shared/trustwallet-service');
const { includeProperty } = require('../../../packages/api-utils');

const BLACKLISTED_MINTS = new Set([
  'Fe8LJUWvwkos8aKqmZRPXV5ovdJr9179rNDx7rMiTiuf',
  'BGQxTNxfgFmpGpvBAcRxkiKPz8NvYrPNDbqCoentfYwK',
  '5YKtbwMFNjMyy4FYSBN2VdHvYoCc8op8VDkbjEdybgSm',
  'HpbiuF8DqfBTxNQuEqD9VhfwTiW2RyB2D5E2kBKGWj11',
  '7Yi1LVVKBYGDanwJCeXoaUd32b3pvRf7ACyTt7kPx87v',
  'jL2WThkfduHSz1gq1rxLDU4VovsY2VNZq7HKanj6Zq7',
  '2yBeRTBRUdqeSDyrxjKXFvVW3cgGu7td4swC9u4b7uqX',
  'AeRB4oQS5XeN692sNQNfbbgH4FRuhY8a4inaxf9PY4gv',
  '8K2bB6iNx3g3KQtvXAESZGkrxVRDue5qaXXnDJL947yx',
  'HcUsR3Pmz7967kovNHykrBBRFVERqYmDqgrfkrYZPLn9',
  'AAnCyGsYXETZ9Z1wHLD5Snx1HjSMS3mFDqg9uRrg3Fwc',
  '9weVgWkGmNw76dtETDxJyChhbmGiHqrARFgF2VCRdcEs',
  '8sSHeuZSd9Jb2fp2BVbs95w66nhtwnrc23vvu1tVdRb4',
]);

/**
 * Side-loads `resource.blacklisted` (boolean). Short-circuits to `true`
 * when `resource.mint` is in the local `BLACKLISTED_MINTS` set; otherwise
 * resolves it via `includeProperty`, matching `resource.media`/`resource.uri`
 * hostnames against the scam-service URL list for `blockchain`.
 * @param {string} blockchain
 * @param {Object} resource - mutated in place; adds `blacklisted` when matched
 * @param {Object} include - relation include map
 * @param {string} key - decorator chain key
 * @param {Object} context - per-request context
 * @returns {Promise<void>}
 */
/**
 * Hostname of `url`, lower-cased, or `null` when it is empty or does not parse.
 * `media`/`uri` come from token metadata written by whoever minted the asset,
 * so a malformed value must not throw and fail the whole listing.
 */
const hostnameOf = (url) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const includeBlacklisted = async (blockchain, resource, include, key, context) => {
  if (resource.mint && BLACKLISTED_MINTS.has(resource.mint)) {
    resource.blacklisted = true;
    return;
  }

  const eagerLoad = async () => {
    return scamService.listUrls(blockchain, context.locals);
  };

  const mediaHostname = hostnameOf(resource.media);
  const uriHostname = hostnameOf(resource.uri);

  const select = (urls) => {
    return urls.some((url) => mediaHostname?.endsWith(url) || uriHostname?.endsWith(url));
  };

  await includeProperty(resource, 'blacklisted', eagerLoad, select, include, key, context);
};

/**
 * Side-loads `resource.logo` via `includeProperty`. For `resource.type ===
 * 'native'` resolves the chain's native logo; otherwise looks up
 * `resource.address` in the trustwallet token list for `resource.blockchain`.
 * @param {Object} resource - mutated in place; adds `logo` when resolved
 * @param {Object} include - relation include map
 * @param {string} key - decorator chain key
 * @param {Object} context - per-request context
 * @returns {Promise<void>}
 */
const includeLogo = async (resource, include, key, context) => {
  const { type, blockchain } = resource;

  const eagerLoad = async () => {
    try {
      return await trustwalletService.listTokens(blockchain);
    } catch (err) {
      console.error('Could not get tokens from trustwallet', err.message);
      return [];
    }
  };

  const select = (tokens) => {
    if (type === 'native') {
      return trustwalletService.getNativeLogo(blockchain, context.locals);
    }
    const token = tokens?.find(
      ({ address }) => address?.toLowerCase() === resource.address?.toLowerCase()
    );
    return token?.logoURI;
  };

  await includeProperty(resource, 'logo', eagerLoad, select, include, key, context);
};

module.exports = {
  includeBlacklisted,
  includeLogo,
};
