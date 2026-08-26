# AGENTS.md instructions for `src/routes/solana`

## Responsibility

- expose Solana HTTP surface
- compose Solana routers for accounts, FT, and NFT
- keep Solana path ownership separate from Bitcoin and generic routes

## Rules

- Keep Solana route additions inside this folder.
- Delegate all behavior to Solana controllers.
- Do not shape transaction, token, or NFT payloads here.
- `solana-nft-router.js` exposes only `GET /` (list), `POST /:mintAddress` (burn), and `POST /:mintAddress/transfer`.

## Testing

- If route wiring changes, verify the related controller tests still cover the public behavior.
