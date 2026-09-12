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
- Run one buyback cycle once $ICE exists. **Decision 12 Sep:** $ICE launches on stonk.fun (Raydium LaunchLab, SOL quote, 1 B supply, graduates to a Raydium CPMM ICE/SOL pool). Buyback v2 = COIN → peg_desk sell → USDC → Jupiter → ICE → burn in one keeper-signed instruction with a program-enforced reference-price floor; see CONTRACTS §4a. Localnet needs the LaunchLab + CPMM + Jupiter programs cloned (Jupiter cannot be cloned meaningfully — test the Jupiter hop on devnet/mainnet-fork only; localnet tests stub the route with a direct CPMM swap).
- Rerun `make alt` so the lookup table carries the correct ATAs; then freeze the ALT authority. Close the orphaned DBC config (`4Nmk…`) to reclaim rent.
- Launch 5–10 more markets across categories (Pyth-priced, Switchboard-priced, keeper-signed) to shake out oracle-path differences.

Exit criteria: 72 hours of unattended keeper operation with payouts every 15 minutes and zero manual intervention.

**Status 12 Sep:** the whole loop is proven on localnet (`make localnet`, mainnet Meteora/Pyth/Metaplex bytecode cloned): launch → three funded epochs (claim_dbc, 50/25/25 split, open_epoch CPI, push, finalize) → forced migration on a $300-cap market → migrate_damm_v2 → record_migration → claim_damm → a payout epoch on the migrated pool; breakers applied to all 75 coins; `anchor test` 49/49. Seven real bugs came out of it (see BUILD_STATUS v0.6). The 72 h soak is running on localnet; buyback still needs the $ICE mint + ICE/GLD DAMM pool + `buyback.initialize`. Devnet repeats this once funded (Helius devnet airdrops) with `make init-programs` (KEEPER_PUBKEYS set) and the Pyth key.

## 2. Test and harden (1–2 weeks, overlaps with phase 1)

The ATA-program typo was silent for weeks because nothing exercised the derivation. Close that class of bug.

- Localnet integration suite (Anchor tests) for all four programs: peg_desk mint/burn math with adversarial oracle inputs (stale, zero, max), fee_router split rounding, distributor epoch resume and Merkle claim, buyback slippage.
- SDK unit tests for every PDA/ATA derivation against known-good addresses; snapshot the Meteora CPI discriminators/offsets and assert them against the on-chain program's IDL in CI (Meteora ships upgrades).
- Devnet smoke test in CI: seed → launch → swap → claim → payout on a throwaway mint, nightly.
- `cargo audit`, `cargo clippy -D warnings`, `anchor build --verifiable` and `solana-verify` so the deployed bytecode is reproducible.
- Circuit breakers in peg_desk: per-coin daily mint cap, max oracle deviation vs last price, staleness bound, global pause. These are what protect the USDC reserve if an oracle or the keeper key is compromised.
- Keeper: idempotent cycles, crash-safe epoch state (already partly there), alerting on missed epochs, key rotation procedure.
- **Audit-freeze list (found by the localnet loop, 12 Sep):** switch fee_router (and the other three programs) from `emit!` to `emit_cpi!` — the launch transaction overruns Solana's 10 KB log limit, so `PoolRegistered` is truncated and the indexer currently reconciles pools from `PoolState` instead; `claim_damm` is now thresholded on the position's unclaimed COIN fee like `claim_dbc` (keeper, done).

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

### 6a. Hosting decision (12 Sep 2026 prices)

What runs where — one deployable per box, nothing shares a process with the keeper:

| Piece | Host | Why | ≈ $/mo |
|---|---|---|---|
| Web (Next.js) | Vercel Pro | Hobby forbids commercial use; Pro adds flat-rate CDN + spike protection | 20 |
| Keeper (long-running, hot wallet) | Fly.io machine, shared-cpu-1x / 1 GB, always on | per-second billing, secrets built in, no base fee; ~$5.70 for the machine | 6–12 |
| Indexer (Fastify webhook receiver + backfill) | Fly.io machine, same size | same | 6 |
| Postgres | Neon Launch (10 GB, PITR-style branching) | managed backups, cheapest paid Postgres; Supabase Pro is $25 and buys nothing we use | 5 |
| RPC + webhooks | Helius Developer (10 M credits, 50 RPS, webhooks) | keeper + indexer webhooks + server-side reads; upgrade to Business ($499) only when credits run out | 49 |
| Errors / uptime | Sentry free + Better Stack (or UptimeRobot) free | keeper "missed epoch" alert goes to Telegram/Discord via webhook | 0 |
| **Total** | | | **≈ 90** |

Cheaper still: one Hetzner CX22-class VPS (~€4–8) running keeper + indexer + Postgres under Docker Compose,
Vercel Hobby dropped for Cloudflare Pages (free, commercial OK). ≈ $55/mo all-in, but one box is one failure
domain and you own backups, so it is the pre-audit option, not the mainnet one.

Rules that hold on either setup: the browser never holds an RPC key with write scope (web reads go through
Next.js route handlers with a server-side Helius key, or a second key with domain allow-listing); the keeper
key lives in Fly secrets at launch and moves to a KMS-backed signer before caps are raised; Postgres is
reachable only from the Fly private network; every service exposes `/healthz` and Better Stack pages on it.
The dominant mainnet cost is not hosting but payout transaction fees + priority/Jito tips, which scale with
holders × 96 epochs/day — budget that from the fee split, not the infra line.

## 7. Mainnet deployment (runbook)

The executable version of this section, with costs and the guarded-launch policy, is **docs/MAINNET_RUNBOOK.md** (12 Sep).

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
