# Feature Specification: Token-2022 NFTs whose metadata sits behind a pointer

**Feature Branch**: `019-token2022-nft-metadata`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "The Seeker Genesis Token does not show in the wallet's collectibles. Make it readable: name, image, animation, and that it cannot be sent."

## Context

Every Solana Seeker receives the Seeker Genesis Token (SGT), a Token-2022 NFT. Read on mainnet for mint `5vPkA3YXK6ByvioKaEyQofqT4QXVWMCXqpvYshswXkCb`:

- The mint carries **no metadata of its own**. Its `metadataPointer` names another account, `GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te` — the SGT **group** mint — whose `tokenMetadata` holds `name: "Seeker Genesis Token"`, `symbol: "SeekerGT"` and `uri` of an off-chain JSON with `image` (PNG) and `animation_url` (MP4).
- The mint is a `tokenGroupMember` of that same group.
- The owner's token account is **frozen** (the issuer holds the freeze authority and a permanent delegate): the holder can neither send nor burn it.

Today the listing returns the SGT twice: DAS reports it as `V1_NFT` with empty content (the resource drops it as non-NFT), and the Token-2022 leg reports only the mint address. With no name, no URI and no image, the spam score hides the item. The detail lookup (`/nft/:mint`) returns the same empty record.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See the Seeker Genesis Token (Priority: P1)

A Seeker owner opens Collectibles in Salmon and sees the Seeker Genesis Token with its name and image, like any other NFT.

**Independent Test**: list the NFTs of a wallet holding an SGT (recorded fixture, plus one live read in quickstart): the SGT is in the default listing with `name: "Seeker Genesis Token"` and a `media` URL.

**Acceptance Scenarios**:

1. **Given** a wallet holding a Token-2022 NFT whose metadata is on the mint itself, **When** its NFTs are listed, **Then** the item carries that name, symbol and URI.
2. **Given** a wallet holding a Token-2022 NFT whose metadata pointer names its own group, **When** its NFTs are listed, **Then** the item carries the group's name, symbol and URI, and the image from the URI's document.
3. **Given** a Token-2022 NFT whose metadata pointer names an account that is **not** its group, **When** its NFTs are listed, **Then** that metadata is not used (anyone can point a mint at a well-known account; only group membership is approved by the group's authority).
4. **Given** the detail of such an NFT is requested by mint, **Then** it carries the same name, symbol, URI and image as in the listing.

### User Story 2 - Its animation and that it cannot be sent (Priority: P2)

The listing tells the wallet where the NFT's animation is and that the token cannot be moved, so the wallet can play it and not offer Send or Burn.

**Acceptance Scenarios**:

1. **Given** an NFT whose document has an `animation_url`, **When** it is listed, **Then** the item carries it as `animation`.
2. **Given** an NFT whose token account is frozen, **When** it is listed, **Then** the item carries `frozen: true`.

### Edge Cases

- The pointer names the mint itself: the mint's own `tokenMetadata` is used.
- The pointed account cannot be read or has no `tokenMetadata`: the item stays as today (no worse).
- The metadata RPC read fails: the listing still answers, items stay as today, the failure is logged.
- A Token-2022 NFT that DAS already names: unchanged.

## Requirements _(mandatory)_

- **FR-001**: For every listed or looked-up NFT without a name whose mint is a Token-2022 mint, the backend MUST read the mint's on-chain `tokenMetadata`, or follow its `metadataPointer` to another account only when the mint is a `tokenGroupMember` of exactly that account.
- **FR-002**: The resolved `name`, `symbol` and `uri` MUST feed the existing off-chain metadata hydration, so `media`, description and spam scoring work as for any NFT.
- **FR-003**: The resource MUST add `animation` (the document's `animation_url`, normalized like `media`, or null) and `frozen` (true when the holder's token account is frozen, else false). Both are additive; no existing field changes.
- **FR-004**: Reading metadata MUST cost at most two batched account reads per listing page source and MUST fail open (log, keep the item as today).
- **FR-005**: The public contract note for `solana-nft-listing` MUST record the new fields and the pointer rule.

## Success Criteria _(mandatory)_

- **SC-001**: A wallet holding an SGT sees it in the default listing, with name and image.
- **SC-002**: A Token-2022 NFT pointing at an account it is not a member of is not shown with that account's metadata.
- **SC-003**: Existing NFT tests and the healthy-wallet spam fixtures pass unchanged.

## Assumptions

- Proving that a token is a genuine SGT (to unlock Seeker-only features) is a separate spec; this one only displays it.
- Playing the animation in the app is the frontend's work; this spec only exposes where it is.
