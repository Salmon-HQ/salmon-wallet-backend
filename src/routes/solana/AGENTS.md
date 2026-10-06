# AGENTS.md instructions for `src/routes/solana`

## Responsibility

- expose Solana HTTP surface
- compose Solana routers for accounts, FT, NFT, and Powerups
- keep Solana path ownership separate from Bitcoin and generic routes

## Rules

- Keep Solana route additions inside this folder.
- Delegate all behavior to Solana controllers.
- Do not shape transaction, token, or NFT payloads here.
- `solana-nft-router.js` exposes only `GET /` (list), `POST /:mintAddress` (burn), and `POST /:mintAddress/transfer`.
- `solana-ft-router.js` exposes `GET /verified`, `GET /search` and `GET /swap/build`; the swap build sits behind `controller.swapNetworkOnly` (400 off mainnet before any table read or screening call) and `powerupGate('swap')`.
- `solana-powerups-router.js` exposes only `GET /availability` (declared first, so the literal path wins over `/:id`) and `GET /:id/build`, the latter behind `src/middlewares/powerup-gate.js` (`powerupGate('param')`, spec 018). Never add an execute/relay route under `/powerups`.

## Testing

- If route wiring changes, verify the related controller tests still cover the public behavior.
