const BITCOIN = 'bitcoin';
const ETHEREUM = 'ethereum';
const SOLANA = 'solana';

/**
 * Every blockchain code has a vertical slice present in the repo
 * (`src/{routes,controllers,services,resources}/<chain>`). The
 * blockchain-mount loop in `src/index.js` requires each entry's
 * `src/routes/<chain>/index.js` at boot, so a chain listed here MUST
 * have at least an empty router exported.
 *
 * FE-visible activation is controlled separately by
 * `src/network-capabilities/network-capabilities-${stage}.js`. A chain
 * can be in this array without being enabled in any stage's capability
 * matrix (e.g. Ethereum today: code is present, FE never reaches it).
 */
const BLOCKCHAINS = [BITCOIN, SOLANA, ETHEREUM];

module.exports = {
  BITCOIN,
  ETHEREUM,
  SOLANA,
  BLOCKCHAINS,
};
