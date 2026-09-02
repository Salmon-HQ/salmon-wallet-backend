# Contracts asserted unchanged: Drop `@solana/spl-token`

This feature removes a dependency. No contract changes; the following are
the contracts whose _bytes_ the change could affect and how each is pinned.

## Public (AGENTS.md "API contracts")

| Contract                       | Touch point                                               | Pin                                                           |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| `solana-nft-burn`              | edition burn: close-account instruction in `burn-service` | new golden spec (base64 wire tx, fixed blockhash)             |
| `solana-nft-burn`              | master edition                                            | existing `burn-master-edition-equivalence.spec.js`, untouched |
| NFT transfer (`/nft/transfer`) | pNFT destination ATA derivation                           | new golden spec: on-curve + off-curve (PDA) destination       |
| `solana-nft-listing`           | Token-2022 account filter in `das-shared`                 | unit test asserts literal program id                          |
| `multichain-account-balance`   | Token program filter in `solana-address-service`          | unit test asserts literal program id                          |

Response shapes are untouched — every boundary value is a base58 or base64
string.

## Internal

- `solana-address-service` gains exports `TOKEN_PROGRAM_ID`,
  `TOKEN_2022_PROGRAM_ID`, `findAssociatedTokenAddressSync(owner, mint)`.
  Existing `findAssociatedTokenAddress` keeps its signature and delegates.
- `getATA` is removed if no caller exists (verify with grep at implementation
  time).

## Security

`SECURITY.md` "Production" table loses its only row. The "Already resolved via
overrides" bullets stay — none of them depended on `@solana/spl-token`.
