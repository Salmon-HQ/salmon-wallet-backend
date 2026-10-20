# Quickstart: run and verify locally

1. `.env`: `JUPITER_API_KEY` (present), `ZEROEX_API_KEY`, `SWAP_FEE_ACCOUNT_OWNER`, `SWAP_FEE_BPS=50`, optional `AVAILABILITY_TABLE_JSON` (local override of the SSM document), `SANCTIONS_SOURCE_URL`.
2. `docker compose up -d` (Redis 6379 inside the network; the local `.env` points at 6380 for the host — override `REDIS_PORT=6379` for the container).
3. Seed the sanctions copy once, in the API's namespace: `docker compose exec -e STAGE=local backend node -e "require('./src/jobs/handler').refreshSanctionsJob()"` (cache keys carry `STAGE`; without it the job writes where the API never reads).
4. Availability: `curl -H 'X-Salmon-Platform: android' http://localhost:3001/local/v1/solana-mainnet/powerups/availability` → `swap` `enabled: false` with `reason: 'region'`: a local source address resolves to no country, and swap is offered only where the country is known.
5. Force a country locally with `AVAILABILITY_COUNTRY_OVERRIDE` (local stage only, ignored on prod): `AR` → `swap` enabled with `provider: 'jupiter'`; `SG` (or `US`, `TW`) → `provider: '0x'`; `GB` (or `CN`, `CU`) → `swap` disabled with `reason: 'region'`. Steps 6 and 7 need a country that Jupiter serves, such as `AR`.
6. Build: `curl "http://localhost:3001/local/v1/solana-mainnet/ft/swap/build?inputMint=So111…112&outputMint=EPjF…Dt1v&uiAmount=0.01&publicKey=<wallet>"` → unsigned transaction, `provider: 'jupiter'`, `salmonFee` line. Decode with the script in spec 012's quickstart to confirm zero signatures and the fee account among the instructions.
7. Screening: put a known listed address as `publicKey` → `403 wallet_restricted`.
8. Tests: `npx jest src/availability src/services/solana/swap src/services/shared/sanctions* src/__tests__/signing-boundary.spec.js`.
