'use strict';

const { BITCOIN, ETHEREUM, SOLANA } = require('./blockchains');
const heliusClient = require('../infrastructure/helius-client');
const tritonClient = require('../infrastructure/triton-client');

/**
 * Returns the canonical Solana RPC URL for the given environment, preferring
 * Triton when configured. The bare-RPC fallback in solana-transaction-service
 * and the Connection objects in burn-service / solana-address-service all
 * read this `nodeUrl`. Without this redirect, Triton-only deploys still
 * route their bare-RPC calls to Helius.
 *
 * @param {string} environment - Solana cluster ('mainnet' | 'testnet' | 'devnet').
 * @returns {string} JSON-RPC URL for the resolved provider.
 */
const solanaNodeUrl = (environment) => {
  if (tritonClient.isConfigured(environment)) {
    return tritonClient.getRpcUrl(environment);
  }
  return heliusClient.getRpcUrl(environment);
};

const ETHEREUM_MAINNET_RPC_URL = process.env.ETHEREUM_MAINNET_RPC_URL || 'https://eth.llamarpc.com';
const ETHEREUM_SEPOLIA_RPC_URL = process.env.ETHEREUM_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

/**
 * Canonical network catalog. Each entry is a chain+environment pair
 * (`id`) consumed by `multinetwork` middleware to resolve `req.params.networkId`
 * into `res.locals.network`, and by `network-capabilities-${stage}.js` to
 * gate which networks are FE-enabled per stage.
 */
module.exports = [
  {
    id: 'bitcoin-mainnet',
    blockchain: BITCOIN,
    environment: 'mainnet',
    name: 'Bitcoin',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/bitcoin/info/logo.png',
    currency: {
      symbol: 'BTC',
      decimals: 8,
    },
    config: {},
  },
  {
    id: 'bitcoin-testnet',
    blockchain: BITCOIN,
    environment: 'testnet',
    name: 'Bitcoin Testnet',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/bitcoin/info/logo.png',
    currency: {
      symbol: 'BTC',
      decimals: 8,
    },
    config: {},
  },
  {
    id: 'solana-mainnet',
    blockchain: SOLANA,
    environment: 'mainnet',
    name: 'Solana',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/solana/info/logo.png',
    currency: {
      symbol: 'SOL',
      decimals: 9,
    },
    config: {
      nodeUrl: solanaNodeUrl('mainnet'),
    },
  },
  {
    id: 'solana-testnet',
    blockchain: SOLANA,
    environment: 'testnet',
    name: 'Solana Testnet',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/solana/info/logo.png',
    currency: {
      symbol: 'SOL',
      decimals: 9,
    },
    config: {
      nodeUrl: solanaNodeUrl('testnet'),
    },
  },
  {
    id: 'solana-devnet',
    blockchain: SOLANA,
    environment: 'devnet',
    name: 'Solana Devnet',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/solana/info/logo.png',
    currency: {
      symbol: 'SOL',
      decimals: 9,
    },
    config: {
      nodeUrl: solanaNodeUrl('devnet'),
    },
  },
  {
    id: 'ethereum-mainnet',
    blockchain: ETHEREUM,
    environment: 'mainnet',
    name: 'Ethereum Mainnet',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png',
    currency: {
      symbol: 'ETH',
      decimals: 18,
    },
    config: {
      rpcUrl: ETHEREUM_MAINNET_RPC_URL,
      chainId: 1,
    },
  },
  {
    id: 'ethereum-sepolia',
    blockchain: ETHEREUM,
    environment: 'sepolia',
    name: 'Ethereum Sepolia',
    icon: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png',
    currency: {
      symbol: 'ETH',
      decimals: 18,
    },
    config: {
      rpcUrl: ETHEREUM_SEPOLIA_RPC_URL,
      chainId: 11155111,
    },
  },
];
