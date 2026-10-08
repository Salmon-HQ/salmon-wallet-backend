# Implementation Plan: Token-2022 NFTs whose metadata sits behind a pointer

**Branch**: `019-token2022-nft-metadata` | **Spec**: [spec.md](spec.md)

## Summary

Resolve on-chain Token-2022 metadata for the NFTs the Token-2022 leg of the listing returns (and for a nameless Token-2022 asset looked up by mint), following a metadata pointer only to the mint's own token group; carry the token account's frozen state; expose `animation` and `frozen` in the NFT resource.

## Technical Context

Node 24, Express/Serverless, `@solana/web3.js` 1.99 (`getMultipleParsedAccounts`), Jest. Provider: Triton (DAS + RPC), through the existing budgeted connection.

## Design

- **`src/services/solana/providers/token2022-metadata.js`** (new, next to `das-shared.js`):
  - `pickMetadata(mint, mintInfo, accounts)` — pure: the mint's own `tokenMetadata`; else, when `metadataPointer.metadataAddress` is another account **and** `tokenGroupMember.group` equals it, that account's `tokenMetadata`; else null.
  - `resolveToken2022Metadata(connection, mints)` — two batched `getMultipleParsedAccounts` reads (mints, then the accepted pointer targets), 100 per call; returns `Map<mint, {name, symbol, uri}>`; logs `[TOKEN2022_METADATA]` and returns an empty map on failure.
- **`das-shared.fetchToken2022NftsByOwner`**: adds `frozen: state === 'frozen'`.
- **`triton-provider.getNftsByOwner`**: fills `name/symbol/uri` on Token-2022 leg items from the resolver; drops a DAS item with an empty name whose mint the Token-2022 leg also returns (it is the same token, read without its metadata).
- **`triton-provider.getNftByMint`**: when DAS returns no name and `token_info.token_program` is Token-2022, fills `name/symbol/uri` the same way.
- **Resource** (`solana-nft-resource.js`): `animation: normalizeIpfsUrl(json?.animation_url) || null`, `frozen: nft.frozen === true`.
- Hydration, spam scoring and image overrides are unchanged: they now see a name and a URI.

## Why the group rule

A metadata pointer is set by whoever creates the mint and can name any account, so following it blindly lets a spam mint wear another collection's name and image. Group membership is different: Token-2022 only lets a mint join a group with the group's update authority signing. A pointer that names the mint's own group is therefore approved by that group's issuer.

## Contract

`solana-nft-listing`: two additive fields (`animation`, `frozen`); recorded in `AGENTS.md`. The frontend reads neither yet; deployed clients ignore unknown fields.

## Verification

Unit tests (Jest, recorded mainnet account shapes for the SGT); `npm run test:unit`, `lint:check`, `format:check`; quickstart: local read of the SGT holder's listing against Triton (read-only).
