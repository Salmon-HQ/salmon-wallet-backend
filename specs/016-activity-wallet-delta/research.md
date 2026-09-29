# Research — 016 activity wallet delta

Read-only audit, 2026-09-16, against the local backend (serverless offline,
Triton primary) and the Helius parse API for the owner's wallet
`7Q3Hm2QkDLJyy727sNc2AeH2vZxiPgWWXX6vTq8Ras6n`.

## The three transactions of 2026-09-14 15:02 UTC (one block)

| Signature       | Provider type                                                                                            | What the ledger says for the wallet                                                                                                                                                                                                                                       | What the app said                                        |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `qTqrNXwJTNHE…` | Helius `TRANSFER` / source METAPLEX, description "7Q3H transferred 1 Mindfolk Founder #5154 **to 7Q3H**" | native `+3,597,268` lamports (six accounts closed at 550,840 each, minus 5×11,016 + 18,837 to `burn68…`, minus 2×1,056,640 to `MrFnJa…`/`A5NGDQ…`, minus fee 24,895); the pNFT moved between two of the wallet's own token accounts (two `tokenTransfers` from=to=wallet) | "Sent": −1 MNDFLK ×2, −0.000011 SOL ×5, −0.001057 SOL ×2 |
| `YAFiJvU91nRZ…` | Helius `UNKNOWN`; Triton typed it `TRANSFER`                                                             | native `+9,983,831` (five accounts closed at 2,039,280 each, minus 5×40,785 to `burn68…`, minus fee 8,644)                                                                                                                                                                | "Sent −0.000041 SOL ×5 to burn…Qxgt"                     |
| `66Z9aAPtCgKw…` | `TRANSFER`                                                                                               | two accounts closed, 2×11,016 to `burn68…`                                                                                                                                                                                                                                | "Sent −0.000011 SOL ×2 to burn…Qxgt"                     |

Programs: `72K97smKVfVtf1fam4s5w2D2msLTeHwoKsjQn9uqVg17` and
`CLEANALo6FtS6quqTTEXDGFFTuSKMkeKGgcweeiPRJzK`, fee vault `burn68h9dS2tvZwtCFMt79SyaEgvqtcZZWJphizQxgt`
(vanity addresses; an account-cleanup service). Names not confirmed:
solana.fm answered 502 and Solscan's API needs a token.

## July round-trips with `9mpJ…SAd3`

`WHGqYrpLj2…` (send): `tokenTransfers` MNDFLK 1 from wallet to `9mpJ…`,
`nativeTransfers` 1,447,680 to `4WyLZ47S…` (royalty). `4zy5h69wgS…`
(receive): MNDFLK 1 from `9mpJ…`. Correctly read today; the royalty leg is
noise the owner flagged.

## Where the behaviour comes from

- `helius-transaction-resource.js` `mapTransactionType`: `TRANSFER` with the
  wallet as both sender and receiver → `inferDirectionalType` says
  `INTERACTION` → discarded, `return SEND`.
- `getDirectional`: one leg per provider transfer of the chosen side; the
  other side is never built.
- `src/services/solana/parser/index.js` `collectAccountData` already emits
  per-account native deltas from `preBalances/postBalances` "so the
  resource reads what the wallet actually gained or lost in SOL from here"
  — nothing reads it yet, and `tokenBalanceChanges` is left empty.
- Helius Enhanced payloads carry `accountData[].{nativeBalanceChange,
tokenBalanceChanges[]{userAccount, tokenAccount, mint, rawTokenAmount}}`;
  verified on the raw parse of `qTqrN…` and `YAFiJ…`.
- Frontend: `transactionCounterparty` reads `outputs[0].destination` /
  `inputs[0].source`; `matchesFilter('other')` is by exclusion, so
  `interaction` rows land under OTHER; the row draws every leg with its
  sign. No contract change needed.

## Documentation consulted

- Helius docs index (`/docs/llms.txt`): Enhanced Transactions is "a legacy
  product in maintenance mode"; the successor Parsed Events documents
  `nativeTransfers` (`fromUserAccount`, `toUserAccount`, `amount` in
  lamports) and `tokenTransfers` (`rawTokenAmount` + `decimals`), not
  `accountData`. Ledger balances (`getTransaction` `meta.preBalances`,
  `postBalances`, `preTokenBalances`, `postTokenBalances`) are the stable
  source; the parser already reads them.
- Practice in wallets (Phantom, Backpack, Solflare): net balance change per
  asset decides direction and amounts; transfers name the counterparty;
  dust, rent and protocol fees fold into the net; self-transfers net to
  nothing.
