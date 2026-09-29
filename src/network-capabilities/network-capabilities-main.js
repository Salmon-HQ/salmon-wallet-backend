/**
 * Network-capability matrix for the `main` stage. Declares which
 * networks are enabled and which UI sections / features are active per
 * blockchain (overview, token_detail, collectibles, transactions).
 *
 * Stage selection happens in `src/services/shared/network-capabilities-service.js`,
 * which loads `network-capabilities-${NODE_ENV}.js` based on `NODE_ENV`.
 *
 * The four stage files (develop/local/main/prod) agree on the network
 * matrix; they only diverge in the `powerups` block (the `memo` reference
 * Powerup is enabled on `local` alone). They are kept as separate files so
 * a stage divergence is a one-file edit, not a refactor.
 */

const { SOLANA } = require('../constants/blockchains');

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
    transactions: {
      active: '*',
    },
  },
  // Powerups offered on this stage, by id (registry:
  // `src/services/solana/powerups/registry.js`). `reason` only when
  // `enabled: false`, one of `region` | `maintenance` | `deprecated`.
  powerups: {
    // Payments: read-only entry, the device asks and pays (frontend spec 033).
    payments: { enabled: true },
  },
};
