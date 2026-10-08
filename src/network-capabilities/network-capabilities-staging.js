/**
 * Network-capability matrix for the `staging` stage: a mirror of `prod`
 * where the Powerups under test are switched on. Declares which
 * networks are enabled and which UI sections / features are active per
 * blockchain (overview, token_detail, collectibles, transactions).
 *
 * Stage selection happens in `src/services/shared/network-capabilities-service.js`,
 * which loads `network-capabilities-${NODE_ENV}.js` based on `NODE_ENV`.
 *
 * The stage files (develop/local/main/prod/staging) agree on the network
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
    // Swap (spec 018): on here so partners can test it before the prod launch.
    swap: { enabled: true },
    // SKR (spec 021): read-only staking view; off on prod until it ships.
    skr: { enabled: true },
  },
};
