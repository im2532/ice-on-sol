SHELL := /bin/bash
SOLANA_VERSION ?= 2.1.21
ANCHOR_VERSION ?= 0.31.1

.PHONY: bootstrap toolchain deps build idl test devnet-deploy seed keeper web fmt

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
	anchor build
	$(MAKE) idl
	pnpm -r --filter './packages/**' build

## Copies Anchor IDLs where the web app can fetch them (keeper/scripts read target/idl directly)
idl:
	mkdir -p apps/web/public/idl && cp target/idl/*.json apps/web/public/idl/

test:
	anchor test

## Deploys all four programs to devnet and writes IDs into .env
devnet-deploy:
	solana config set --url devnet
	anchor build
	$(MAKE) idl
	anchor deploy --provider.cluster devnet
	pnpm exec tsx scripts/write-program-ids.ts

## Creates GlobalConfig + all Tier-A commodities on the current cluster
seed:
	pnpm exec tsx scripts/seed-commodities.ts

keeper:
	pnpm --filter @icemarkets/keeper dev

web:
	pnpm --filter @icemarkets/web dev

fmt:
	cargo fmt --all
	pnpm exec prettier -w "**/*.{ts,tsx,json,md}"
