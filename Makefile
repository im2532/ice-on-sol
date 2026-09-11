SHELL := /bin/bash
# Make cargo/solana visible even in a shell that has not re-sourced its profile.
export PATH := $(HOME)/.cargo/bin:$(HOME)/.local/share/solana/install/active_release/bin:$(HOME)/.avm/bin:$(PATH)
SOLANA_VERSION ?= 2.1.21
ANCHOR_VERSION ?= 0.31.1
# Solana 2.1.x ships cargo 1.79; modern crates need edition2024, so build with newer platform tools.
PLATFORM_TOOLS ?= v1.57
ANCHOR_BUILD := anchor build -- --tools-version $(PLATFORM_TOOLS)

.PHONY: bootstrap toolchain deps build idl web-deployments test devnet-deploy seed alt keeper web fmt

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
	@cargo build-sbf --tools-version $(PLATFORM_TOOLS) --install-only

deps:
	pnpm install

build:
	$(ANCHOR_BUILD)
	$(MAKE) idl
	pnpm -r --filter './packages/**' build

## Copies Anchor IDLs where the web app can fetch them (keeper/scripts read target/idl directly)
idl:
	mkdir -p apps/web/public/idl && cp target/idl/*.json apps/web/public/idl/

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

## Creates GlobalConfig + all Tier-A commodities on the current cluster
seed:
	pnpm exec tsx scripts/seed-commodities.ts

## Creates/extends the launch Address Lookup Table (after `seed`) and publishes it to the web app
alt:
	pnpm exec tsx scripts/create-alt.ts
	$(MAKE) web-deployments

keeper:
	pnpm --filter @icemarkets/keeper dev

web:
	pnpm --filter @icemarkets/web dev

fmt:
	cargo fmt --all
	pnpm exec prettier -w "**/*.{ts,tsx,json,md}"
