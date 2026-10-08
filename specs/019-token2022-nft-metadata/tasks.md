# Tasks: Token-2022 NFTs whose metadata sits behind a pointer

- [x] T001 [US1] Tests: `pickMetadata` — own metadata; pointer to own group; pointer to a non-group account refused; no extensions → null
- [x] T002 [US1] Tests: `resolveToken2022Metadata` — two batched reads, map by mint, fail-open on RPC error
- [x] T003 [US1] Implement `token2022-metadata.js`
- [x] T004 [US1][US2] Tests + implement: Token-2022 leg carries `frozen`; `getNftsByOwner` fills metadata and drops the empty DAS twin
- [x] T005 [US1] Tests + implement: `getNftByMint` fills metadata for a nameless Token-2022 asset
- [x] T006 [US2] Tests + implement: resource `animation` and `frozen`
- [x] T007 Record the contract change in `AGENTS.md` (`solana-nft-listing`)
- [x] T008 Gates: `test:unit`, `lint:check`, `format:check`; quickstart live read
