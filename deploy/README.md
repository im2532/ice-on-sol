# Deploying ICEmarkets services (MAINNET_PLAN §6a)

| Piece | Where | How |
|---|---|---|
| web | Vercel Pro, root directory `apps/web` | git push → auto deploy |
| keeper | Fly.io app `icemarkets-keeper` | `fly deploy -c deploy/fly/keeper.toml` |
| indexer (API + Helius webhook) | Fly.io app `icemarkets-indexer` | `fly deploy -c deploy/fly/indexer.toml` |
| Postgres | Neon (Launch) | `psql "$DATABASE_URL" < apps/indexer/schema.sql` once, then `deployments/<cluster>.sql` after each `make seed` |
| RPC / webhooks | Helius (Developer) | one key for keeper + indexer + Vercel server-side; webhook → `https://icemarkets-indexer.fly.dev:8443/helius` |

## First-time Fly setup (run from the repo root)

```sh
brew install flyctl && fly auth login          # payment method must be on file (dashboard banner)
fly apps create icemarkets-keeper
fly apps create icemarkets-indexer

# keeper secrets: everything the keeper reads from .env that is not in keeper.toml [env]
fly secrets set -a icemarkets-keeper \
  RPC_URL="https://devnet.helius-rpc.com/?api-key=…" HELIUS_API_KEY="…" PYTH_API_KEY="…" \
  DATABASE_URL="postgres://…neon…/icemarkets?sslmode=require" \
  PEG_DESK_PROGRAM_ID=… FEE_ROUTER_PROGRAM_ID=… DISTRIBUTOR_PROGRAM_ID=… BUYBACK_PROGRAM_ID=… \
  KEEPER_KEYPAIR_JSON="$(cat keys/keeper.json)"

fly secrets set -a icemarkets-indexer \
  RPC_URL="https://devnet.helius-rpc.com/?api-key=…" DATABASE_URL="postgres://…" \
  HELIUS_WEBHOOK_AUTH_HEADER="$(openssl rand -hex 24)" \
  PEG_DESK_PROGRAM_ID=… FEE_ROUTER_PROGRAM_ID=… DISTRIBUTOR_PROGRAM_ID=… BUYBACK_PROGRAM_ID=…

fly deploy -c deploy/fly/keeper.toml
fly deploy -c deploy/fly/indexer.toml
fly logs -a icemarkets-keeper
```

Keypairs never go in the image: `docker-entrypoint.sh` writes `KEEPER_KEYPAIR_JSON` to `/app/keys/keeper.json` at boot.
The image reads IDLs from `apps/web/public/idl` (committed) — run `make idl web-deployments` and commit after every `anchor build`.

Mainnet: change `SOLANA_CLUSTER` in both toml files, move the keeper key to a KMS-backed signer, and set `primary_region` next to your RPC.
