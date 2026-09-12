/**
 * Pins the hand-built Meteora CPIs and raw account layouts in programs/{fee_router,buyback} to the
 * IDLs shipped with the pinned @meteora-ag SDK packages (the same IDLs the keeper/web use to talk
 * to the live programs). Bump the SDK → this test tells you whether the Rust constants still hold.
 *
 * What is pinned, and where the Rust source of truth lives:
 *   - instruction discriminators + account order/flags/args
 *       fee_router/src/cpi_ext/dbc.rs      claim_trading_fee, partner_withdraw_surplus
 *       fee_router/src/cpi_ext/damm_v2.rs  claim_position_fee
 *       buyback/src/cpi_ext/mod.rs         swap
 *   - account discriminators + byte offsets read by register_pool / record_migration
 *       fee_router/src/constants.rs        dbc_layout, damm_layout
 *
 * Offsets are computed by walking the IDL type graph (zero-copy structs are repr(C) with explicit
 * padding fields, so the Borsh-style sum of field sizes equals the on-chain layout). If Meteora ever
 * reorders a struct, the computed offset moves and the assertion fails — which is the point.
 */
import { createHash } from "node:crypto";
import { expect } from "chai";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Idl = any;
const DBC: Idl = DynamicBondingCurveIdl;
const CP: Idl = CpAmmIdl;

const disc = (preimage: string): number[] => [...createHash("sha256").update(preimage).digest().subarray(0, 8)];

// ---- constants mirrored from the Rust sources (keep in sync by hand; the test is the check) ----
const RUST = {
  dbc: {
    CLAIM_TRADING_FEE_DISCRIMINATOR: [8, 236, 89, 49, 152, 125, 177, 81],
    PARTNER_WITHDRAW_SURPLUS_DISCRIMINATOR: [168, 173, 72, 100, 201, 98, 38, 92],
    MIGRATION_DAMM_V2_DISCRIMINATOR: [156, 169, 230, 103, 53, 228, 80, 64],
    POOL_CONFIG_DISCRIMINATOR: [26, 108, 14, 123, 116, 230, 129, 43],
    VIRTUAL_POOL_DISCRIMINATOR: [213, 224, 5, 209, 98, 69, 119, 92],
    CONFIG_QUOTE_MINT_OFFSET: 8,
    CONFIG_FEE_CLAIMER_OFFSET: 40,
    CONFIG_MIN_LEN: 72,
    POOL_CONFIG_OFFSET: 72,
    POOL_CREATOR_OFFSET: 104,
    POOL_BASE_MINT_OFFSET: 136,
    POOL_IS_MIGRATED_OFFSET: 305,
    POOL_MIN_LEN: 306,
  },
  damm: {
    CLAIM_POSITION_FEE_DISCRIMINATOR: [180, 38, 154, 17, 133, 33, 162, 211],
    SWAP_DISCRIMINATOR: [248, 198, 158, 145, 225, 117, 135, 200],
    POOL_DISCRIMINATOR: [241, 154, 109, 4, 17, 177, 109, 188],
    POSITION_DISCRIMINATOR: [170, 188, 143, 228, 122, 64, 247, 208],
    POSITION_POOL_OFFSET: 8,
    POSITION_NFT_MINT_OFFSET: 40,
    POSITION_MIN_LEN: 72,
  },
};

/** [name, writable, signer] exactly as the Rust `meta(...)` calls build the CPI. */
type Meta = [string, boolean, boolean];
const RUST_ACCOUNTS: Record<string, Meta[]> = {
  claim_trading_fee: [
    ["pool_authority", false, false],
    ["config", false, false],
    ["pool", true, false],
    ["token_a_account", true, false],
    ["token_b_account", true, false],
    ["base_vault", true, false],
    ["quote_vault", true, false],
    ["base_mint", false, false],
    ["quote_mint", false, false],
    ["fee_claimer", false, true],
    ["token_base_program", false, false],
    ["token_quote_program", false, false],
    ["event_authority", false, false],
    ["program", false, false],
  ],
  partner_withdraw_surplus: [
    ["pool_authority", false, false],
    ["config", false, false],
    ["virtual_pool", true, false],
    ["token_quote_account", true, false],
    ["quote_vault", true, false],
    ["quote_mint", false, false],
    ["fee_claimer", false, true],
    ["token_quote_program", false, false],
    ["event_authority", false, false],
    ["program", false, false],
  ],
  claim_position_fee: [
    ["pool_authority", false, false],
    ["pool", true, false],
    ["position", true, false],
    ["token_a_account", true, false],
    ["token_b_account", true, false],
    ["token_a_vault", true, false],
    ["token_b_vault", true, false],
    ["token_a_mint", false, false],
    ["token_b_mint", false, false],
    ["position_nft_account", false, false],
    ["signer", false, true], // Rust field is named `owner`; the IDL calls it `signer`
    ["token_a_program", false, false],
    ["token_b_program", false, false],
    ["event_authority", false, false],
    ["program", false, false],
  ],
  swap: [
    ["pool_authority", false, false],
    ["pool", true, false],
    ["input_token_account", true, false],
    ["output_token_account", true, false],
    ["token_a_vault", true, false],
    ["token_b_vault", true, false],
    ["token_a_mint", false, false],
    ["token_b_mint", false, false],
    ["payer", false, true],
    ["token_a_program", false, false],
    ["token_b_program", false, false],
    ["referral_token_account", false, false], // Option::None → program id, non-writable
    ["event_authority", false, false],
    ["program", false, false],
  ],
};

// ---- IDL walking ------------------------------------------------------------------------------
const PRIM: Record<string, number> = { pubkey: 32, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, bool: 1 };

function sizeOf(idl: Idl, t: Idl): number {
  if (typeof t === "string") {
    if (PRIM[t] === undefined) throw new Error(`unsupported primitive ${t}`);
    return PRIM[t];
  }
  if (t.array) return sizeOf(idl, t.array[0]) * t.array[1];
  if (t.defined) {
    const d = idl.types.find((x: Idl) => x.name === t.defined.name);
    if (!d) throw new Error(`type ${t.defined.name} missing`);
    if (d.type.kind === "struct") return d.type.fields.reduce((a: number, f: Idl) => a + sizeOf(idl, f.type), 0);
    if (d.type.kind === "enum") return 1;
  }
  throw new Error(`unsupported type ${JSON.stringify(t)}`);
}

/** Byte offsets (incl. the 8-byte discriminator) of every field, nested as "outer.inner". */
function offsets(idl: Idl, typeName: string, base = 8, prefix = "", out: Record<string, number> = {}): Record<string, number> {
  const d = idl.types.find((x: Idl) => x.name === typeName);
  if (!d) throw new Error(`type ${typeName} missing`);
  let o = base;
  for (const f of d.type.fields) {
    out[prefix + f.name] = o;
    if (f.type.defined) {
      const dd = idl.types.find((x: Idl) => x.name === f.type.defined.name);
      if (dd?.type.kind === "struct") offsets(idl, dd.name, o, `${prefix}${f.name}.`, out);
    }
    o += sizeOf(idl, f.type);
  }
  out[`${prefix}__len`] = o;
  return out;
}

const ix = (idl: Idl, name: string) => {
  const i = idl.instructions.find((x: Idl) => x.name === name);
  expect(i, `instruction ${name} in IDL`).to.not.equal(undefined);
  return i;
};
const acct = (idl: Idl, name: string) => {
  const a = idl.accounts.find((x: Idl) => x.name === name);
  expect(a, `account ${name} in IDL`).to.not.equal(undefined);
  return a;
};

function checkAccounts(idl: Idl, name: string) {
  const i = ix(idl, name);
  const ours = RUST_ACCOUNTS[name];
  expect(i.accounts.map((a: Idl) => a.name), `${name}: account order`).to.deep.equal(ours.map((m) => m[0]));
  i.accounts.forEach((a: Idl, k: number) => {
    const [n, writable, signer] = ours[k];
    // Our CPI may over-mark writable (harmless); it must never under-mark it, and signers must match exactly.
    if (a.writable && !a.optional) expect(writable, `${name}.${n} must be writable`).to.equal(true);
    expect(signer, `${name}.${n} signer flag`).to.equal(Boolean(a.signer));
  });
}

// ---- tests -----------------------------------------------------------------------------------
describe("meteora layout: DBC (dynamic bonding curve)", () => {
  it("IDL is the expected major version", () => {
    expect(String(DBC.metadata?.version ?? "")).to.match(/^0\.2\./);
  });

  it("instruction discriminators", () => {
    expect(ix(DBC, "claim_trading_fee").discriminator).to.deep.equal(RUST.dbc.CLAIM_TRADING_FEE_DISCRIMINATOR);
    expect(ix(DBC, "partner_withdraw_surplus").discriminator).to.deep.equal(RUST.dbc.PARTNER_WITHDRAW_SURPLUS_DISCRIMINATOR);
    expect(ix(DBC, "migration_damm_v2").discriminator).to.deep.equal(RUST.dbc.MIGRATION_DAMM_V2_DISCRIMINATOR);
    // and they are the canonical sha256("global:<name>") values
    expect(disc("global:claim_trading_fee")).to.deep.equal(RUST.dbc.CLAIM_TRADING_FEE_DISCRIMINATOR);
    expect(disc("global:migration_damm_v2")).to.deep.equal(RUST.dbc.MIGRATION_DAMM_V2_DISCRIMINATOR);
  });

  it("claim_trading_fee / partner_withdraw_surplus account order, flags and args", () => {
    checkAccounts(DBC, "claim_trading_fee");
    expect(ix(DBC, "claim_trading_fee").args.map((a: Idl) => a.type)).to.deep.equal(["u64", "u64"]);
    checkAccounts(DBC, "partner_withdraw_surplus");
    expect(ix(DBC, "partner_withdraw_surplus").args).to.deep.equal([]);
  });

  it("PoolConfig / VirtualPool discriminators and the offsets register_pool reads", () => {
    expect(acct(DBC, "PoolConfig").discriminator).to.deep.equal(RUST.dbc.POOL_CONFIG_DISCRIMINATOR);
    expect(acct(DBC, "VirtualPool").discriminator).to.deep.equal(RUST.dbc.VIRTUAL_POOL_DISCRIMINATOR);

    const cfg = offsets(DBC, "PoolConfig");
    expect(cfg.quote_mint).to.equal(RUST.dbc.CONFIG_QUOTE_MINT_OFFSET);
    expect(cfg.fee_claimer).to.equal(RUST.dbc.CONFIG_FEE_CLAIMER_OFFSET);
    expect(cfg.__len).to.be.gte(RUST.dbc.CONFIG_MIN_LEN);

    // VirtualPool wraps a PoolState; the router reads through the wrapper.
    const pool = offsets(DBC, "VirtualPool");
    const f = (name: string) => pool[name] ?? pool[`pool_state.${name}`];
    expect(f("config"), "VirtualPool.config").to.equal(RUST.dbc.POOL_CONFIG_OFFSET);
    expect(f("creator"), "VirtualPool.creator").to.equal(RUST.dbc.POOL_CREATOR_OFFSET);
    expect(f("base_mint"), "VirtualPool.base_mint").to.equal(RUST.dbc.POOL_BASE_MINT_OFFSET);
    expect(f("is_migrated"), "VirtualPool.is_migrated").to.equal(RUST.dbc.POOL_IS_MIGRATED_OFFSET);
    expect(pool.__len).to.be.gte(RUST.dbc.POOL_MIN_LEN);
  });
});

describe("meteora layout: DAMM v2 (cp-amm)", () => {
  it("IDL is the expected major version", () => {
    expect(String(CP.metadata?.version ?? "")).to.match(/^0\.2\./);
  });

  it("instruction discriminators", () => {
    expect(ix(CP, "claim_position_fee").discriminator).to.deep.equal(RUST.damm.CLAIM_POSITION_FEE_DISCRIMINATOR);
    expect(ix(CP, "swap").discriminator).to.deep.equal(RUST.damm.SWAP_DISCRIMINATOR);
  });

  it("claim_position_fee / swap account order, flags and args", () => {
    checkAccounts(CP, "claim_position_fee");
    expect(ix(CP, "claim_position_fee").args).to.deep.equal([]);
    checkAccounts(CP, "swap");
    // swap(SwapParameters { amount_in: u64, minimum_amount_out: u64 }) — encoded as two LE u64s
    const params = CP.types.find((t: Idl) => t.name === "SwapParameters");
    expect(params.type.fields.map((f: Idl) => [f.name, f.type])).to.deep.equal([
      ["amount_in", "u64"],
      ["minimum_amount_out", "u64"],
    ]);
    expect(ix(CP, "swap").accounts.find((a: Idl) => a.name === "referral_token_account").optional).to.equal(true);
  });

  it("Pool / Position discriminators and the offsets record_migration reads", () => {
    expect(acct(CP, "Pool").discriminator).to.deep.equal(RUST.damm.POOL_DISCRIMINATOR);
    expect(acct(CP, "Position").discriminator).to.deep.equal(RUST.damm.POSITION_DISCRIMINATOR);
    const pos = offsets(CP, "Position");
    expect(pos.pool).to.equal(RUST.damm.POSITION_POOL_OFFSET);
    expect(pos.nft_mint).to.equal(RUST.damm.POSITION_NFT_MINT_OFFSET);
    expect(pos.__len).to.be.gte(RUST.damm.POSITION_MIN_LEN);
  });
});
