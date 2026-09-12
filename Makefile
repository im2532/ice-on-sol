SHELL := /bin/bash
# Make cargo/solana visible even in a shell that has not re-sourced its profile.
export PATH := $(HOME)/.cargo/bin:$(HOME)/.local/share/solana/install/active_release/bin:$(HOME)/.avm/bin:$(PATH)
# Keep in sync with [toolchain] solana_version in Anchor.toml.
SOLANA_VERSION ?= 4.2.2
ANCHOR_VERSION ?= 0.31.1
# Solana 2.1 bundles cargo 1.79 which cannot parse edition-2024 crates; Anchor.toml pins a current Agave CLI
# and avm/anchor activate it automatically on `anchor build`.
ANCHOR_BUILD := anchor build

.PHONY: bootstrap toolchain deps build idl sizes web-deployments test devnet-deploy init-programs seed breakers ice alt smoke transfer-authority db keeper web fmt

## One-shot dev machine setup (macOS / Linux). Idempotent.
bootstrap: toolchain deps
	@echo "✓ bootstrap done. Next: make build && make test"

toolchain:
	@command -v rustup >/dev/null || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
	@command -v solana >/dev/null || sh -c "$$(curl -sSfL https://release.anza.xyz/v$(SOLANA_VERSION)/install)"
	@command -v avm >/dev/null || cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
	@avm install $(ANCHOR_VERSION) && avm use $(ANCHOR_VERSION)
	@command -v pnpm >/dev/null || npm i -g pnpm@9
	@solana --version && anchor --version

deps:
	pnpm install

build:
	$(ANCHOR_BUILD)
	$(MAKE) idl
	pnpm -r --filter './packages/**' build

## Copies Anchor IDLs where the web app can fetch them (keeper/scripts read target/idl directly)
idl:
	mkdir -p apps/web/public/idl && cp target/idl/*.json apps/web/public/idl/

## Program sizes and mainnet rent (rent-exempt = (bytes + 128) × 6 960 lamports; ProgramData adds 45 bytes).
## Pass SOL_USD=<price> for a USD column. Uses target/verifiable/*.so when present (the build you deploy).
sizes:
	@dir=target/verifiable; [ -d $$dir ] && ls $$dir/*.so >/dev/null 2>&1 || dir=target/deploy; \
	echo "binaries: $$dir"; total=0; \
	printf "%-12s %10s %9s %9s\n" program bytes SOL USD; \
	for f in $$dir/*.so; do \
	  b=$$(stat -f%z $$f 2>/dev/null || stat -c%s $$f); total=$$((total+b)); \
	  awk -v n=$$(basename $$f .so) -v b=$$b -v p=$${SOL_USD:-0} 'BEGIN{s=(b+45+128)*6960/1e9; printf "%-12s %10d %9.3f %9.0f\n", n, b, s, s*p}'; \
	done; \
	awk -v b=$$total -v p=$${SOL_USD:-0} 'BEGIN{s=(b+4*(45+128))*6960/1e9; printf "%-12s %10d %9.3f %9.0f\n", "TOTAL", b, s, s*p}'

## Publishes deployments/<cluster>.json (launch ALT address) to the web app (/deployments/<cluster>.json)
web-deployments:
	mkdir -p apps/web/public/deployments && (cp deployments/*.json apps/web/public/deployments/ 2>/dev/null || true)

test:
	anchor test

## Deploys all four programs to devnet and writes IDs into .env
devnet-deploy:
	solana config set --url devnet
	$(ANCHOR_BUILD)
	$(MAKE) idl
	anchor deploy --provider.cluster devnet
	pnpm exec tsx scripts/write-program-ids.ts

## One-time fee_router / distributor configs on the current cluster (idempotent)
init-programs:
	pnpm exec tsx scripts/init-programs.ts

## Creates GlobalConfig + all Tier-A commodities on the current cluster
seed:
	pnpm exec tsx scripts/seed-commodities.ts

## Applies per-tier circuit breakers (daily mint/redeem caps, price-deviation bound) to every seeded commodity
breakers:
	pnpm exec tsx scripts/set-breakers.ts

## Localnet/devnet stand-in for the stonk.fun $ICE launch: ICE mint + DAMM v2 ICE/USDC pool + buyback.initialize
ice:
	pnpm exec tsx scripts/create-ice-localnet.ts

## Hands every admin role (+ upgrade authority with UPGRADE=1) to NEW_AUTHORITY (Squads vault). Dry run unless EXECUTE=1.
transfer-authority:
	pnpm exec tsx scripts/transfer-authority.ts --to $(NEW_AUTHORITY) $(if $(EXECUTE),--execute,) $(if $(UPGRADE),--upgrade,)

## Read-only health check of the current cluster deployment (SMOKE_TRADE=1 adds a 1 USDC round-trip)
smoke:
	pnpm exec tsx scripts/devnet-smoke.ts

## Creates/extends the launch Address Lookup Table (after `seed`) and publishes it to the web app
alt:
	pnpm exec tsx scripts/create-alt.ts
	$(MAKE) web-deployments

## Full loop on a fresh local validator (validator + programs + seed + breakers + ALT + db + keeper + indexer + web)
localnet:
	scripts/localnet-up.sh

## Embedded dev Postgres (no system install needed): applies indexer schema + deployments/<cluster>.sql
db:
	pnpm exec tsx scripts/dev-postgres.ts

keeper:
	pnpm --filter @icemarkets/keeper dev

web:
	pnpm --filter @icemarkets/web dev

fmt:
	cargo fmt --all
	pnpm exec prettier -w "**/*.{ts,tsx,json,md}"
