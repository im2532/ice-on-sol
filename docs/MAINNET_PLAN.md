# ICEmarkets — road to mainnet

Status at time of writing (2026-09-11): first market ($BG / BURGER) launched end-to-end on devnet through the real stack in tx `5Ye5tS73…CPon` (peg_desk buy_exact_out → DBC initialize_virtual_pool → creator first swap → fee_router register_pool). Seven files of launch fixes are uncommitted on the Mac.

The order below is deliberate: each phase is a gate for the next. Nothing goes to mainnet before phase 4 is signed off.

## 0. Bank the win (today)

- Commit the 7 launch fixes (`packages/sdk/src/{dbc,launch,pda}.ts`, `packages/registry/src/programs.ts`, `Makefile`, `scripts/init-programs.ts`, web env handling) and tag `devnet-e2e-1`.
- Record the launch tx, pool, config and `$BG` mint in `docs/BUILD_STATUS.md`.
- Add `make init-programs` to the bootstrap docs — the fee_router/distributor configs will need the same step on mainnet.

## 1. Close the devnet loop (this week)

The launch proves the write path. The money path (fees → split → payouts every 15 min → migration → buyback) is still unverified against a real pool.

- Fund devnet wallets (admin, keeper, your wallet) so the keeper can run for days, not hours.
- Bring up the indexer against devnet: Helius devnet webhook → Postgres; confirm `$BG`'s pool row appears and swaps decode.
- Let the keeper fee cycle claim from the `$BG` pool, confirm the 50/25/25 split lands (holders / treasury / buyback), and watch the first three 15‑minute payout epochs land in holder ATAs (test with 3+ holder wallets, including one that buys mid-epoch and one that sells to zero).
- Push `$BG` past the migration threshold and confirm DAMM v2 migration + fee claiming continues from the DAMM pool.
- Run one buyback cycle (GLD → ICE burn) once GLD is seeded.
- Rerun `make alt` so the lookup table carries the correct ATAs; then freeze the ALT authority. Close the orphaned DBC config (`4Nmk…`) to reclaim rent.
- Launch 5–10 more markets across categories (Pyth-priced, Switchboard-priced, keeper-signed) to shake out oracle-path differences.

Exit criteria: 72 hours of unattended keeper operation on devnet with payouts every 15 minutes and zero manual intervention.

## 2. Test and harden (1–2 weeks, overlaps with phase 1)

The ATA-program typo was silent for weeks because nothing exercised the derivation. Close that class of bug.

- Localnet integration suite (Anchor tests) for all four programs: peg_desk mint/burn math with adversarial oracle inputs (stale, zero, max), fee_router split rounding, distributor epoch resume and Merkle claim, buyback slippage.
- SDK unit tests for every PDA/ATA derivation against known-good addresses; snapshot the Meteora CPI discriminators/offsets and assert them against the on-chain program's IDL in CI (Meteora ships upgrades).
- Devnet smoke test in CI: seed → launch → swap → claim → payout on a throwaway mint, nightly.
- `cargo audit`, `cargo clippy -D warnings`, `anchor build --verifiable` and `solana-verify` so the deployed bytecode is reproducible.
- Circuit breakers in peg_desk: per-coin daily mint cap, max oracle deviation vs last price, staleness bound, global pause. These are what protect the USDC reserve if an oracle or the keeper key is compromised.
- Keeper: idempotent cycles, crash-safe epoch state (already partly there), alerting on missed epochs, key rotation procedure.

## 3. Governance and keys (before audit starts)

- Squads multisig (3-of-5 or similar) as upgrade authority for all four programs, admin of peg_desk/fee_router/distributor/buyback, and treasury owner. Keeper stays a hot wallet with only the signer role and a small SOL float.
- Timelock on upgrades (Squads supports this); publish the policy in docs.
- Decide and document when upgrade authority is burned (typical: after a second audit and 3–6 months of mainnet operation).

## 4. Security audit (4–8 weeks lead time; book now)

peg_desk custodies the USDC reserve and fee_router/distributor touch every fee. Both need third-party review before mainnet — OtterSec, Neodyme, Sec3, Zellic, or Halborn are the usual Solana shops; get two quotes. Scope: the four programs, the CPI layer (`cpi_ext/`), and the keeper's signing path for KeeperSigned prices. Freeze program code before the audit starts; land only audit fixes afterwards, then re-verify the build hash.

Run a public bug bounty (Immunefi) from mainnet day one.

## 5. Oracles and the reserve

- Pyth mainnet feed IDs for the ~21 Pyth coins (Hermes with `PYTH_API_KEY`); Switchboard On-Demand mainnet feeds for the coins currently relayed via KeeperSigned — the fewer keeper-signed prices on mainnet, the better.
- KeeperSigned coins (food, watches, CS2, cards, RSGP, vendor futures) are a trust assumption. Disclose it plainly in docs, require ≥2 sources where possible, widen the Peg Desk spread for them, and cap daily mint volume per coin.
- Reserve capitalisation: each commodity coin is minted against USDC at oracle price, so the reserve only ever holds what users deposited — but the spread and circuit breakers are the only thing standing between an oracle error and a drained reserve. Model worst cases per category before setting caps.

## 6. Mainnet infrastructure

- RPC: Helius (or Triton) paid plan with a dedicated endpoint for the keeper and webhooks for the indexer; a second provider as fallback.
- Keeper: supervised service (Fly.io / Railway / a small EC2) with health checks, Jito tips for payout transactions, PagerDuty/Telegram alerts on missed epochs or low SOL.
- Indexer: managed Postgres with PITR backups; Helius mainnet webhook; backfill job for gaps.
- Web: Vercel (or similar), Sentry, uptime monitor, mainnet cluster config, geo-restriction list enforced at the edge.
- Secrets: keeper key in a KMS/secret manager, never in `.env` on a laptop.

## 7. Mainnet deployment (runbook)

1. Deploy the four programs from the verified build via the multisig; run `anchor keys sync` against mainnet IDs; verify on-chain hash.
2. `make init-programs` on mainnet (fee_router, distributor, buyback configs, peg_desk global) via multisig.
3. Register the mainnet USDC mint in the registry; create the commodity mints + Metaplex metadata; seed oracle feeds.
4. Create the launch ALT, freeze it.
5. Deploy `$ICE` and its DBC/DAMM pool (tokenomics, initial liquidity and buyback destination decided beforehand).
6. Keeper and indexer pointed at mainnet, running for 24 h with no markets.
7. Soft launch: a handful of markets in the most liquid categories (GLD, CL, BURGER-class, one card, one watch) with low daily mint caps; team and early users only.
8. Raise caps and open all categories once 1–2 weeks of payouts have run clean.

Budget: program deployment rent (~2–6 SOL per program depending on size), 96 mints + metadata (~0.03 SOL each), one DBC config per pair, and ongoing payout tx fees (holders × epochs ÷ ~20 per tx) plus RPC/infra subscriptions.

## 8. Legal, compliance, and comms

Not legal advice — get counsel before mainnet. Tokens whose value tracks commodities, and fee-sharing to holders, can attract derivatives or securities treatment in several jurisdictions; the geo-restriction list, Terms of Service, risk disclosures, and the operating entity should be settled with a lawyer. Prepare docs (how fees flow, what KeeperSigned means, what the Peg Desk is and isn't), the X account content, the trailer, and an incident-response contact before launch.

## Still open from BUILD_STATUS

Post-migration DAMM trading in the UI, Switchboard futures vendor feed, RSGP source stub, indexer transfer coverage, design-canvas vocabulary refresh.
