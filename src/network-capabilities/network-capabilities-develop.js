/**
 * Network-capability matrix for the `develop` stage. Declares which
 * networks are enabled and which UI sections / features are active per
 * blockchain (overview, token_detail, collectibles, swap, exchange,
 * transactions).
 *
 * Stage selection happens in `src/services/shared/network-capabilities-service.js`,
 * which loads `network-capabilities-${NODE_ENV}.js` based on `NODE_ENV`.
 *
 * The four stage files (develop/local/main/prod) are currently
 * byte-identical because the matrices agree across stages. They are
 * kept as separate files so a future stage divergence (e.g. enabling a
 * feature only in `develop`) is a one-file edit, not a refactor.
 */

const { BITCOIN, SOLANA } = require('../constants/blockchains');

module.exports = {
  enable: [
    'bitcoin-mainnet',
    'bitcoin-testnet',
    'solana-mainnet',
    'solana-testnet',
    'solana-devnet',
  ],
  sections: {
    overview: {
      active: '*',
      features: {
        send: '*',
        receive: '*',
        list_tokens: '*',
        import_tokens: [],
        collectibles: [SOLANA],
      },
    },
    token_detail: {
      active: '*',
      features: {
        send: '*',
        receive: '*',
      },
    },
    collectibles: {
      active: [SOLANA],
      send: [SOLANA],
      burn: [SOLANA],
    },
    swap: {
      active: [SOLANA],
    },
    exchange: {
      active: [SOLANA, BITCOIN],
    },
    transactions: {
      active: '*',
    },
  },
};
