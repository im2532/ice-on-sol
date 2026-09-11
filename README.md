# ICEmarkets — Commodity Market Exchange on Solana

Memecoins paired with commodity coins (gold, crude, wheat, a Dragon Lore, a Charizard) instead of SOL. 40% of every
trading fee is paid to holders in the commodity coin, automatically, every 15 minutes. A Solana fork of
[commodites.market](https://www.commodites.market) built on Meteora DBC → DAMM v2, Pyth + Switchboard, and four small Anchor programs.

Spec, feasibility and plan: [`docs/ICEMARKETS_SPEC.md`](docs/ICEMARKETS_SPEC.md). Interfaces: [`docs/CONTRACTS.md`](docs/CONTRACTS.md).
Build status and what's verified: [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md).

```
programs/            Anchor programs (Rust)
  peg_desk/          Commodity coin issuer: mint/burn at oracle ± spread against a USDC reserve
  fee_router/        DBC/DAMM v2 fee_claimer PDA; splits 50/25/25 → holders / $ICE buyback / protocol
  distributor/       15-minute holder payouts (push to existing ATAs + Merkle claims)
  buyback/           Converts fee share → $ICE on the ICE/GLD pool → burn
packages/
  registry/          Canonical list of 83 commodity coins + 2 index coins (units, feeds, tiers, params)
  sdk/               TS: PDAs, pricing (parity-tested vs Rust), launch/trade builders, Merkle, TWAB
apps/
  keeper/            Oracle pusher, session calendar, fee claims, payouts, migrations, buyback, arb
  indexer/           Postgres schema, REST API, Helius webhook ingestion, candles
  web/               Next.js 15 app: Markets · Commodities · Launch · Token · Rewards · Docs
scripts/             seed-commodities, write-program-ids, create-index-coin, print-discriminators
tests/               anchor ts-mocha tests (peg_desk, distributor)
docs/                Spec, contracts, research (01–05), review log, build status
```

## Quick start (macOS / Linux)

```bash
make bootstrap        # rustup, solana 2.1.x, anchor 0.31.1 via avm, pnpm install
make build            # anchor build (with platform-tools v1.57) + copy IDLs + build packages
make test             # anchor test (local validator clones Meteora/Pyth/Metaplex from mainnet — needs network)
cp .env.example .env  # fill RPC_URL (Helius), keypair paths
make devnet-deploy    # deploy 4 programs, write ids into Anchor.toml / .env / registry
make seed             # create GlobalConfig + MVP commodities (resolves Pyth feed ids from Hermes)
make keeper           # start cycles
make web              # http://localhost:3000 (NEXT_PUBLIC_USE_MOCK=1 renders without backend)
```

## How a launch works (one transaction, USDC path)

`peg_desk.buy_exact_out(COIN)` → `dbc.create_config` (per-launch config: two-segment curve $5k→$35k, 20% to migration,
fee tier 1/2/3% in quote, `fee_claimer` = fee_router PDA, migration option 6) → `dbc.initialize_virtual_pool_with_spl_token`
→ `dbc.swap` (creator first buy at minimum fee) → `fee_router.register_pool`. SOL path adds a Jupiter SOL→USDC transaction first.

## Status

Written end-to-end; **not yet compiled** — the authoring environment had no access to crates.io / npm / GitHub.
See `docs/BUILD_STATUS.md` for the exact list of what is verified and the VERIFY checklist to run once `anchor build` works.

## License

BUSL-1.1 (programs), MIT (sdk/web). Not investment advice. Commodity coins are synthetic, unbacked, redeemable only against the protocol reserve, and may halt.
