'use strict';

/**
 * Express app bootstrap — mounted behind API Gateway via `handler.js` and
 * `serverless-http`.
 *
 * Wiring order: global middleware (JSON/urlencoded parsing, compression,
 * CORS, request logging) → cross-chain routers (`info`, `multichain`,
 * `coingecko`, `dapp`, `network`, `bridge`) → one router per
 * entry in `BLOCKCHAINS`, mounted at `/v1/<chain>-:env` (see the mount-loop
 * comment below for the per-chain resolver) → a catch-all 404 handler → the
 * final error-handling middleware (`middlewares/error-handler`), which logs
 * and maps the error onto the shared error envelope.
 *
 * Adding a chain: append to `BLOCKCHAINS` (`src/constants/blockchains.js`)
 * and provide `src/routes/<chain>/index.js`; the mount loop below picks it
 * up automatically.
 */

const { applyConnectTuning } = require('./infrastructure/connect-tuning');
const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const compression = require('compression');
const { logger } = require('../packages/middleware');
const rateLimit = require('./middlewares/rate-limit');
const errorHandler = require('./middlewares/error-handler');
const handler = require('./handler');
const NETWORKS = require('./constants/networks');
const { BLOCKCHAINS } = require('./constants/blockchains');

// Raise Node's 250ms per-address connect budget before any provider is
// dialed; see `infrastructure/connect-tuning` for why the default turns a
// slow handshake into a hard failure.
applyConnectTuning();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(compression());
app.use(
  cors({
    allowedHeaders: ['Content-Type'],
    origin: [
      /^https:\/\/.*\.salmonwallet\.io$/,
      /\.salmonwallet\.io$/,
      /^http:\/\/localhost(:\d+)*$/,
      /^https:\/\/d34j6k4ycto37u\.cloudfront\.net$/,
    ],
  })
);
app.use(logger);

// Per-IP rate limiting (fixed window in Redis, fail-open). One global
// limiter over every route (the unversioned /health, /status and /ip info
// endpoints included — /ip calls a third party per request), plus a stricter one over the
// transaction-building routes (Solana NFT burn/transfer and FT swap) —
// those are the expensive/abusable endpoints. Mode/limits come from env.
// RATE_LIMIT_MODE falls back to 'log' here (count and log, don't block);
// prod sets it to 'enforce' via config/env.prod.yml.
const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60;
app.use(
  rateLimit({
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    prefix: 'global',
  })
);
const txRateLimit = rateLimit({
  max: Number(process.env.RATE_LIMIT_TX_MAX) || 30,
  windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  prefix: 'tx',
});
app.use('/v1/solana-:env/nft', txRateLimit);
app.use('/v1/solana-:env/ft/swap', txRateLimit);

app.use('/', require('./routes/shared/info-router'));
app.use('/v1', require('./routes/multichain'));
app.use('/v1', require('./routes/shared/coingecko-router'));
app.use('/v1/dapp', require('./routes/shared/dapp-router'));
app.use('/v1/networks', require('./routes/shared/network-router'));
app.use('/v1/bridge', require('./routes/shared/bridge-router'));
// Mount one chain-specific router per entry in BLOCKCHAINS. Each mount uses a
// chain-prefixed path (`/v1/<chain>-:env`) so a request like
// `/v1/solana-mainnet/...` only matches the solana mount — slice routers all
// expose `/account/...` paths, so without a unique prefix they would shadow
// each other across chains. The mount-level resolver reads the captured env,
// looks the network up in `NETWORKS`, and writes `res.locals.network` so the
// chain's controllers/services can dispatch on it. We do not delegate to the
// `multinetwork` middleware here because Express 5 re-scopes `req.params` per
// layer and the legacy resolver expects `networkId` directly. Adding a chain
// = add to `BLOCKCHAINS` and provide `src/routes/<chain>/index.js`.
BLOCKCHAINS.forEach((chain) => {
  app.use(
    `/v1/${chain}-:env`,
    (req, res, next) => {
      const networkId = `${chain}-${req.params.env}`;
      const network = NETWORKS.find((entry) => entry.id === networkId);
      if (!network) {
        return res.status(400).send({
          error: 'bad_request',
          error_description: `Invalid network: ${networkId}`,
        });
      }
      res.locals.network = network;
      return next();
    },
    require(`./routes/${chain}`)
  );
});

// Catch-all 404 for any request that didn't match a mounted router above.
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    error_description: `Cannot ${req.method} ${req.path}`,
  });
});

// Final Express error-handling middleware (4-arg signature). Maps domain and
// upstream-provider errors onto the repo-wide error envelope; see
// `src/middlewares/error-handler.js`.
app.use(errorHandler);

/**
 * Lambda entry point: wraps the Express app for API Gateway via
 * `serverless-http`, then wraps that in `./handler` for the warmup
 * short-circuit.
 */
module.exports.handler = handler(serverless(app));
