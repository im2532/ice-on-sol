# Review 3 — SDK/keeper/scripts/tests vs real Anchor IDLs

Cross-checked every `program.methods.<ix>(...).accountsPartial/.accountsStrict/.accounts({...})`
call in the SDK, keeper, scripts, tests and web against the REAL Anchor 0.31-generated IDLs at
`target/idl/{peg_desk,fee_router,distributor,buyback}.json`, using a new checker script,
`scripts/check-sdk-vs-idl.ts` (pure Node — `fs`/`path` only — run with `tsx`). It also spot-checks
Anchor event names/fields used in `apps/indexer/src/decode/{anchorEvents,events}.ts` and
`apps/keeper` against each IDL's `events[]`/`types[]`, and PDA seed usage in
`packages/sdk/src/pda.ts` against each IDL account's `pda.seeds`.

Scope did not touch `programs/`; the compiled IDL is canonical and the TS was fixed to match it.

## What the checker does

- Loads all four IDLs and, per instruction, builds the camelCased account-name list (marking each
  account "omittable" from `.accountsPartial` when it has `pda` — PDA-derivable — `address` —
  well-known/auto-resolved — or `optional: true`) and the IDL's declared arg count.
- Scans `packages/sdk/src/{pegDesk,feeRouter,distributor,buyback}.ts`, `apps/keeper/src/**/*.ts`,
  `scripts/*.ts`, `tests/*.ts`, `apps/web/lib/actions.ts` with a tolerant brace-matching regex scan
  (not a full TS parser): for every `<receiver>.methods.<ix>(...)` call it resolves which program
  the receiver targets (`getProgram("name")`, `this.program`, an `anchor.workspace.X` binding, or —
  as a fallback — a method name unique to one program), checks the method exists, counts positional
  args against the IDL, then resolves the following `.accountsPartial/.accountsStrict/.accounts({...})`
  object's keys (including through `...spreadCall(...)` of a same-file helper, resolved recursively)
  and checks every key against the IDL's account list, and (for `.accountsPartial`) that every
  non-omittable account is present.
- Exits non-zero on any mismatch; strips comments before parsing so a stray `:` in a trailing
  comment can't be mistaken for an object key.

## What it found and fixed

One real drift, one call site:

- **`apps/keeper/src/cycles/buyback.ts` — `buyback.convertAndBurn` account key.** The IDL's
  `bb_icemarkets` account camelCases to `bbIcemarkets` (Anchor only uppercases the single letter
  right after an underscore — there is no second underscore in `icemarkets` to produce a capital
  `M`), but the keeper passed `bbIceMarketz`... `bbIceMarkets` (capital `M`). Fixed to
  `bbIcemarkets: getAssociatedTokenAddressSync(iceMint, bbAuth, true)`.

Everything else checked out clean:

- **Instruction/account/arg-count checks** — every `.methods.<ix>()` call in `pegDesk.ts`,
  `tests/peg_desk.test.ts`, `tests/distributor.test.ts`, and the keeper cycles
  (`buyback.ts`, `payouts.ts`, `fees.ts`, `migrate.ts`) matches its IDL instruction's camelCased
  method name, account names (including through the `tradeAccounts`/`splitAccounts`/`pushAccounts`/
  `claimAccounts`/`oracleAccounts` helper spreads), and arg count. `packages/sdk/src/feeRouter.ts`
  and `distributor.ts` are hand-encoded (no IDL, discriminator + fixed key order) rather than
  `program.methods` calls; their account order was checked by hand against `register_pool`'s and
  `claim`'s IDL account order and matches exactly. `packages/sdk/src/buyback.ts` does not exist (the
  buyback program has no browser-side hand-encoded builder; keeper-side calls go through
  `program.methods` as checked above). `apps/web/lib/actions.ts` makes no direct `program.methods`
  calls — it only calls into the SDK.
- **Event names/fields** (`apps/indexer/src/decode/events.ts`, `anchorEvents.ts`, and the
  `e.name === "..."` checks in `apps/keeper/src/cycles/{buyback,fees}.ts` and
  `apps/keeper/src/cycles/payouts.ts`'s `Payout` reconciliation) — every `case "program.EventName":`
  in `events.ts` names a real IDL event, and every `field(d, "snake_case")` call inside that case
  matches a real field of that event's IDL type. No drift.
- **PDA seeds** (`packages/sdk/src/pda.ts` vs `pda.seeds` in all four IDLs) — checked by hand
  (const-seed bytes + account-path seeds) for every PDA the SDK derives:
  `peg_desk` (`config`, `commodity`, `reserve`, `keeperPrice`, `mintAuth`), `fee_router` (`router`,
  `pool`, `holderVault`, `buybackVault`, `treasury`, `routerQuoteRecv` as an ATA), `distributor`
  (`config`, `distAuth`, `epoch`, `epochVault` as an ATA, `claimed`), `buyback` (`state`,
  `authority`). One subtlety worth recording: `fee_router`'s `buyback_vault` PDA is seeded off
  `quote_mint` in `register_pool`/`claim_dbc`/`claim_dbc_surplus` but off `coin_mint` in
  `withdraw_for_buyback` — these are the same physical mint under different local Anchor-account
  names (the pool's quote token *is* the COIN mint), so `pda.ts`'s single `buybackVault(programId,
  coinMint)` helper is correct as written; no fix needed. All seeds match.

## Result

`tsx scripts/check-sdk-vs-idl.ts` now exits 0. Verified the checker actually catches drift by
temporarily corrupting the fixed account key and re-running (it reported the mismatch), then
reverting and confirming a clean run again.

Typecheck (local `tsc` has no `@types/node` available in this checkout, so `--types node` was added
against a global copy to typecheck; the script itself has zero runtime dependencies beyond
`node:fs`/`node:path`):

```
tsc --ignoreConfig --strict --skipLibCheck --noEmit --target es2022 --module commonjs \
  --moduleResolution node scripts/check-sdk-vs-idl.ts
```
