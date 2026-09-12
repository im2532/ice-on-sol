# ICEmarkets — mainnet go-live runbook

Written 12 Sep 2026 against head 4933ec6 (localnet money loop proven end to end; 49/49 tests; buyback v2).
Companion to MAINNET_PLAN.md: the plan says *what* gates mainnet, this says *how* to do it, in order, with
the numbers. Every command runs from the repo root on the deploy laptop with `.env` = `.env.mainnet.example`
filled in.

## 0. Go / no-go — read this first

The programs are **unaudited**. `peg_desk` custodies user USDC and `fee_router` touches every fee. The plan
(§4) says no public mainnet before a third-party audit, and that still stands. What is defensible today is a
**guarded launch**: deploy, hand every key to a multisig, run with daily caps at 10 % of the tier defaults
(`BREAKER_SCALE_BPS=1000`), Peg Desk `per_tx_cap` small, and only markets the team seeds — so the worst case
of an undiscovered bug is bounded to what the caps let through per day, and the pause switches stop it.
Public marketing, the stonk.fun `$ICE` launch, and raising the caps wait for the audit report.

If you are not willing to run capped and team-only until the audit is done, stop here and book the audit
first (OtterSec / Neodyme / Sec3 / Zellic / Halborn; 4–8 weeks lead time).

## 1. Cost (SOL ≈ $104, 12 Sep 2026)

| Item | SOL | Notes |
|---|---|---|
| 4 program deployments (1.74 MB of bytecode, deployed at exact size) | ≈ 12.5 | `solana program deploy --max-len <size>` per program; devnet was 8.7 with older builds. Double it if you deploy with the default 2× buffer. |
| 96 commodity mints + Metaplex metadata + `Commodity` accounts + reserve vaults | ≈ 1.2 | ~0.012 SOL each |
| Program configs, launch ALT, buyback state, ATAs | ≈ 0.3 | |
| Keeper float (priority fees + payouts) | 3–5 | refill weekly; 96 epochs/day × pools × ceil(holders/20) txs |
| Reserve seeding (USDC, not SOL) | $500–2,000 per launched coin | `deposit_reserve` so sweeps stay ≥ 102 % from day one; optional but recommended for the first markets |
| **Total to start** | **≈ 20 SOL (~$2,100) + USDC seed** | |

Infra ≈ $90/month (MAINNET_PLAN §6a). The `$ICE` launch on stonk.fun costs ≈ 0.012 SOL plus whatever you buy on the curve.

## 2. Prerequisites (yours; nothing below runs without them)

1. **Wallets.** `keys/mainnet-admin.json` (deploy + seed; 20 SOL), `keys/mainnet-keeper.json` (5 SOL). Both fresh, generated offline, never used on devnet.
2. **Squads vault** (app.squads.so): 2-of-3 minimum with keys on separate devices. Its vault address is `ADMIN_MULTISIG` and `TREASURY_PUBKEY`.
3. **Helius mainnet** Developer plan: one key for keeper/indexer/Vercel server-side (`RPC_URL`), a second key domain-restricted to the Vercel domain (`NEXT_PUBLIC_RPC_URL`). Mainnet webhook created after the indexer is up.
4. **Pyth API key** (`PYTH_API_KEY`) — 21 Pyth coins do not price without it.
5. **Neon** production branch, `DATABASE_URL`. `psql "$DATABASE_URL" < apps/indexer/schema.sql`.
6. **Fly + Vercel** already paid; `deploy/README.md` covers them.
7. **Metadata hosting.** `METADATA_BASE_URI` serving `/<SYMBOL>.json` + the SVG marks (Vercel: `apps/web/public/commodities/…` already serves the images; add a JSON per symbol or point the URI at the existing route).
8. **Legal.** Terms, risk disclosure and the geo-block list reviewed by counsel; entity that operates the keeper. Not optional for a product that mints commodity-tracking tokens and shares fees with holders.

## 3. Deploy (once)

```sh
cp .env.mainnet.example .env && $EDITOR .env      # fill everything in §2
solana config set --url "$RPC_URL" --keypair keys/mainnet-admin.json

# 3.1 verifiable build — the hash you publish and the auditors diff against
anchor build --verifiable                          # docker; ~10 min
make idl web-deployments
for p in peg_desk fee_router distributor buyback; do sha256sum target/verifiable/$p.so; done

# 3.2 deploy at exact size (halves rent vs the 2× default); same keypairs → same ids as devnet
for p in peg_desk fee_router distributor buyback; do
  solana program deploy target/verifiable/$p.so --program-id target/deploy/$p-keypair.json \
    --max-len $(stat -f%z target/verifiable/$p.so) --with-compute-unit-price 50000
done
solana-verify verify-from-repo -um --program-id $PEG_DESK_PROGRAM_ID https://github.com/yashishkhurana/IceMarkets --library-name peg_desk   # repeat ×4; publishes the on-chain verification

# 3.3 configs + coins
make init-programs                                # fee_router (50/25/25) + distributor configs, keeper registered
make seed                                         # GlobalConfig + 93 commodities + 3 index coins; writes deployments/mainnet-beta.json + .sql
psql "$DATABASE_URL" < deployments/mainnet-beta.sql
BREAKER_SCALE_BPS=1000 make breakers              # guarded caps: 10 % of tier defaults
make alt                                          # launch lookup table; then freeze it:
solana address-lookup-table freeze <ALT from deployments/mainnet-beta.json>
make web-deployments && git add apps/web/public && git commit -m "mainnet: IDLs + deployments" && git push   # Vercel picks it up

# 3.4 hand over every key (dry run prints; --execute sends; --upgrade also moves upgrade authority)
pnpm exec tsx scripts/transfer-authority.ts --to $ADMIN_MULTISIG
CONFIRM_NEW_AUTHORITY=$ADMIN_MULTISIG pnpm exec tsx scripts/transfer-authority.ts --to $ADMIN_MULTISIG --execute --upgrade
#   then in Squads: proposal = peg_desk.accept_admin; approve; verify `solana program show <id>` ×4 shows the vault
```

After 3.4 the admin laptop key holds nothing. Every later admin action (breaker changes, pauses, `clear_price_anchor`, upgrades) is a Squads proposal. Keep the timelock at 24 h except for `set_global_pause`, which should be immediate.

## 4. Services

```sh
fly secrets set -a icemarkets-keeper  RPC_URL=… HELIUS_API_KEY=… PYTH_API_KEY=… DATABASE_URL=… SOLANA_CLUSTER=mainnet-beta \
  PEG_DESK_PROGRAM_ID=… FEE_ROUTER_PROGRAM_ID=… DISTRIBUTOR_PROGRAM_ID=… BUYBACK_PROGRAM_ID=… \
  FEE_MIN_CLAIM_USD=100 BUYBACK_ROUTE=jupiter BUYBACK_MIN_USD=250 KEEPER_KEYPAIR_JSON="$(cat keys/mainnet-keeper.json)"
fly secrets set -a icemarkets-indexer RPC_URL=… DATABASE_URL=… SOLANA_CLUSTER=mainnet-beta HELIUS_WEBHOOK_AUTH_HEADER=… (+ program ids)
sed -i 's/SOLANA_CLUSTER = "devnet"/SOLANA_CLUSTER = "mainnet-beta"/' deploy/fly/*.toml
fly deploy -c deploy/fly/indexer.toml && fly deploy -c deploy/fly/keeper.toml
# Helius → Webhooks → Enhanced → https://icemarkets-indexer.fly.dev:8443/helius, auth header, the 4 program ids + DBC
# Vercel → env: SOLANA_CLUSTER=mainnet-beta, NEXT_PUBLIC_RPC_URL=<second key>, NEXT_PUBLIC_API_URL=<indexer>
```

Then `SOLANA_CLUSTER=mainnet-beta make smoke` — all four programs, configs, 96 coins fresh, no failures — and 24 h of keeper logs with oracle pushes every cycle and zero errors before anything is launched.

## 5. Guarded launch (team-only, capped)

1. `deposit_reserve` $500–2,000 USDC into GLD, SLV, CL, BURGER and one card/watch coin.
2. Launch one market per category from the UI with the team wallet; trade among team wallets; confirm three payout epochs and one fee claim on mainnet exactly as on localnet.
3. Watch for 7 days: `make smoke` nightly (CI does it), reserve ratios ≥ 102 %, no `PriceDeviationTooLarge` storms, buyback vault filling (buyback stays paused until `$ICE` exists).
4. Caps: `BREAKER_SCALE_BPS=1000` → 2500 → 5000 → 10000 only after the audit report and each step ≥ 1 week clean.

## 6. `$ICE` on stonk.fun (after the audit)

Launch with SOL quote, **2 % fee tier**; creator fees (1 %) accrue to the launch wallet — sweep to `TREASURY_PUBKEY` weekly (manual for now). Then via Squads:
`buyback.initialize(fee_router, peg_desk, swap_program = JUP6…, reserve_buffer 200, max_per_cycle_usdc 2 000 USDC, max_deviation 500, anchor_move 200, min_interval 900, anchor 0)` with `ice_mint` = the stonk.fun mint, `buyback.set_params(keepers)`, `peg_desk.set_redeem_cap_exempt(bb_auth)`; set `ICE_MINT`, `BUYBACK_ROUTE=jupiter` on the keeper. The first cycle sets the rate anchor — run it while watching.

## 7. Incident switches (all Squads proposals; pause is the only one that should skip the timelock)

| Symptom | Switch |
|---|---|
| Oracle print wrong / keeper key suspected | `peg_desk.set_global_pause(true)` (keepers may pause; only the multisig unpauses) |
| One coin misbehaving | `peg_desk.set_status(coin, Halted)` |
| Fee routing wrong | `fee_router.pause(true)` |
| Buyback routing wrong | `buyback.set_params(paused = true)` |
| Legit gap tripped the deviation breaker | `peg_desk.clear_price_anchor(coin)` |

## 8. Still open before public launch (tracked in MAINNET_PLAN)

Audit + Immunefi; `emit_cpi!` (log-truncation fix) in the audit-freeze upgrade; on-chain reference price for the buyback anchor; Switchboard On-Demand feeds for the keeper-relayed coins; KMS-backed keeper signer; Jito bundles for payouts; legal sign-off.
