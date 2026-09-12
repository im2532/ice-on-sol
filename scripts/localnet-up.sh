#!/usr/bin/env bash
# Bring up the full ICEmarkets loop on a fresh local validator (mainnet Meteora/Pyth/Metaplex clones from
# Anchor.toml): programs at genesis, wallets funded, local USDC, program configs + keepers, all coins seeded,
# breakers, launch ALT, dev Postgres (reset), keeper, indexer API, web. Writes .env.localnet from .env.
#   make localnet            (then: scripts/launch-market.ts / trade-market.ts against RPC 127.0.0.1:8899)
# Requires: anchor build already done; .env with keys/admin.json + keys/keeper.json paths.
set -euo pipefail
cd "$(dirname "$0")/.."
U=http://127.0.0.1:8899
LOG=${LOCALNET_LOG_DIR:-.localnet-logs}; mkdir -p "$LOG"

pkill -f "tsx src/main.ts|tsx src/server.ts|next dev|dev-postgres.ts|anchor localnet|solana-test-validator" 2>/dev/null || true
sleep 3
echo "▶ anchor localnet (clones mainnet programs; ~1 min)"
(anchor localnet > "$LOG/validator.log" 2>&1 &)
for _ in $(seq 1 120); do solana cluster-version --url $U >/dev/null 2>&1 && break; sleep 2; done
solana cluster-version --url $U >/dev/null || { echo "validator did not start; see $LOG/validator.log"; exit 1; }

ADMIN=$(solana-keygen pubkey keys/admin.json); KEEP=$(solana-keygen pubkey keys/keeper.json)
solana airdrop 100 "$ADMIN" --url $U >/dev/null 2>&1 || true
solana airdrop 20 "$KEEP" --url $U >/dev/null 2>&1 || true
for w in ${LOCALNET_EXTRA_WALLETS:-}; do solana airdrop 20 "$w" --url $U >/dev/null 2>&1 || true; done
# Meteora DBC's global pool-authority PDA pays DAMM v2 pool rent on migration; Meteora funds it on mainnet.
solana airdrop 10 FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM --url $U >/dev/null 2>&1 || true

echo "▶ local USDC mint"
USDC=$(spl-token create-token --decimals 6 --url $U --fee-payer keys/admin.json --mint-authority keys/admin.json 2>/dev/null | grep -o "Creating token [1-9A-HJ-NP-Za-km-z]*" | awk '{print $3}')
for w in "$ADMIN" ${LOCALNET_EXTRA_WALLETS:-}; do
  spl-token create-account "$USDC" --owner "$w" --url $U --fee-payer keys/admin.json >/dev/null 2>&1 || true
  spl-token mint "$USDC" 100000 --recipient-owner "$w" --url $U --fee-payer keys/admin.json --mint-authority keys/admin.json >/dev/null 2>&1
done
echo "  USDC=$USDC"

echo "▶ .env.localnet"
sed -e "s|^SOLANA_CLUSTER=.*|SOLANA_CLUSTER=localnet|" -e "s|^RPC_URL=.*|RPC_URL=$U|" -e "s|^WS_URL=.*|WS_URL=ws://127.0.0.1:8900/|" \
    -e "s|^NEXT_PUBLIC_RPC_URL=.*|NEXT_PUBLIC_RPC_URL=$U|" -e "s|^# USDC_MINT_OVERRIDE=.*|USDC_MINT_OVERRIDE=$USDC|" -e "s|^USDC_MINT_OVERRIDE=.*|USDC_MINT_OVERRIDE=$USDC|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://icemarkets:icemarkets@localhost:5432/icemarkets_local|" \
    -e "s|^ORACLE_PUSH_INTERVAL=.*|ORACLE_PUSH_INTERVAL=30|" -e "s|^FEE_CYCLE_INTERVAL=.*|FEE_CYCLE_INTERVAL=60|" \
    -e "s|^PAYOUT_MIN_POOL_USD=.*|PAYOUT_MIN_POOL_USD=1|" -e "s|^PAYOUT_MIN_HOLDING_USD=.*|PAYOUT_MIN_HOLDING_USD=0|" -e "s|^PAYOUT_MIN_AMOUNT_USD=.*|PAYOUT_MIN_AMOUNT_USD=0|" \
    -e "s|^IDL_DIR=.*|IDL_DIR=$PWD/target/idl|" -e "s|^KEEPER_KEYPAIR_PATH=.*|KEEPER_KEYPAIR_PATH=$PWD/keys/keeper.json|" -e "s|^ADMIN_KEYPAIR_PATH=.*|ADMIN_KEYPAIR_PATH=$PWD/keys/admin.json|" \
    -e "s|^KEEPER_PUBKEYS=.*|KEEPER_PUBKEYS=$KEEP|" .env > .env.localnet
grep -q "^USDC_MINT_OVERRIDE=" .env.localnet || echo "USDC_MINT_OVERRIDE=$USDC" >> .env.localnet
grep -q "^FEE_MIN_CLAIM_USD=" .env.localnet && sed -i '' "s|^FEE_MIN_CLAIM_USD=.*|FEE_MIN_CLAIM_USD=1|" .env.localnet || echo "FEE_MIN_CLAIM_USD=1" >> .env.localnet
set -a; . ./.env.localnet; set +a

echo "▶ init-programs, seed, breakers, alt"
pnpm exec tsx scripts/init-programs.ts 2>&1 | grep -v WARN
rm -f deployments/localnet.json deployments/localnet.sql
pnpm exec tsx scripts/seed-commodities.ts 2>&1 | grep -c "✓" | sed 's/^/  seeded: /'
pnpm exec tsx scripts/set-breakers.ts 2>&1 | tail -1
pnpm exec tsx scripts/create-alt.ts 2>&1 | grep "Wrote" | cut -c1-100
make web-deployments >/dev/null 2>&1 || true

echo "▶ postgres (reset), keeper, indexer, web"
(RESET_DB=1 pnpm exec tsx scripts/dev-postgres.ts > "$LOG/pg.log" 2>&1 &)
for _ in $(seq 1 40); do grep -q "ready" "$LOG/pg.log" 2>/dev/null && break; sleep 2; done
(cd apps/keeper && pnpm exec tsx src/main.ts > "../../$LOG/keeper.log" 2>&1 &)
(cd apps/indexer && pnpm exec tsx src/server.ts > "../../$LOG/indexer.log" 2>&1 &)
(cd apps/web && pnpm exec next dev -p 3000 > "../../$LOG/web.log" 2>&1 &)
echo "✔ localnet up: RPC $U · web http://localhost:3000 · API http://localhost:4000 · keeper healthz :8787 · logs in $LOG/"
echo "  next: set -a; . ./.env.localnet; set +a; pnpm exec tsx scripts/launch-market.ts --quote BURGER --name X --symbol X"
