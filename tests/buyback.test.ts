/**
 * buyback (v2) on localnet: state initialisation, work-ATA ownership by the bb_auth PDA, and the
 * admin/keeper parameter surface. The full `convert_and_burn` path (fee_router → peg_desk sell →
 * forwarded swap → burn) is exercised by scripts/create-ice-localnet.ts + the keeper on `make localnet`
 * (it needs a seeded commodity with fees and an ICE/USDC DAMM v2 pool).
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

const STATE_SEED = Buffer.from("buyback");
const BB_AUTH_SEED = Buffer.from("bb_auth");

async function expectAnchorError(p: Promise<unknown>, code: string): Promise<void> {
  let threw = false;
  try {
    await p;
  } catch (e: any) {
    threw = true;
    const got: string | undefined = e?.error?.errorCode?.code;
    const haystack = `${got ?? ""} ${e?.message ?? ""} ${(e?.logs ?? []).join("\n")} ${String(e)}`;
    expect(haystack, `expected ${code}`).to.include(code);
  }
  expect(threw, `expected transaction to fail with ${code}`).to.equal(true);
}

/** All-None SetParamsArgs. */
function params(overrides: Record<string, unknown>) {
  return {
    feeRouter: null,
    pegDesk: null,
    swapProgram: null,
    reserveBufferBps: null,
    maxPerCycleUsdc: null,
    maxDeviationBps: null,
    anchorMoveBps: null,
    minIntervalSecs: null,
    icePerUsdcAnchor: null,
    paused: null,
    keepers: null,
    newAdmin: null,
    ...overrides,
  };
}

describe("buyback", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const ws = anchor.workspace as any;
  const program = ws.Buyback as any;
  const feeRouterId: PublicKey = ws.FeeRouter.programId;
  const pegDeskId: PublicKey = ws.PegDesk.programId;
  const DAMM_V2 = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"); // localnet swap router stand-in
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], program.programId);
  const [bbAuth, authBump] = PublicKey.findProgramAddressSync([BB_AUTH_SEED], program.programId);
  const stranger = Keypair.generate();
  let iceMint: PublicKey;
  let usdcMint: PublicKey;

  const initArgs = (overrides: Record<string, unknown> = {}) => ({
    feeRouter: feeRouterId,
    pegDesk: pegDeskId,
    swapProgram: DAMM_V2,
    reserveBufferBps: 200,
    maxPerCycleUsdc: new BN(5_000_000_000), // $5,000
    maxDeviationBps: 500,
    anchorMoveBps: 200,
    minIntervalSecs: 0,
    icePerUsdcAnchor: new BN(0),
    ...overrides,
  });

  const initAccounts = () => ({
    admin: admin.publicKey,
    state: statePda,
    bbAuth,
    iceMint,
    usdcMint,
    bbUsdc: getAssociatedTokenAddressSync(usdcMint, bbAuth, true),
    bbIce: getAssociatedTokenAddressSync(iceMint, bbAuth, true),
    usdcTokenProgram: TOKEN_PROGRAM_ID,
    iceTokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });

  before(async () => {
    const sig = await connection.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    iceMint = await createMint(connection, admin, admin.publicKey, null, 6);
    usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
  });

  it("initialize rejects bps parameters of 100% or more", async () => {
    for (const bad of [{ reserveBufferBps: 10_000 }, { maxDeviationBps: 10_000 }, { anchorMoveBps: 10_000 }]) {
      await expectAnchorError(program.methods.initialize(initArgs(bad)).accountsPartial(initAccounts()).rpc(), "InvalidBps");
    }
  });

  it("initialize creates the state and both work ATAs owned by bb_auth", async () => {
    await program.methods.initialize(initArgs({ reserveBufferBps: 1_000 })).accountsPartial(initAccounts()).rpc();
    const s = await program.account.buybackState.fetch(statePda);
    expect(s.admin.equals(admin.publicKey)).to.equal(true);
    expect(s.feeRouter.equals(feeRouterId)).to.equal(true);
    expect(s.pegDesk.equals(pegDeskId)).to.equal(true);
    expect(s.swapProgram.equals(DAMM_V2)).to.equal(true);
    expect(s.iceMint.equals(iceMint)).to.equal(true);
    expect(s.usdcMint.equals(usdcMint)).to.equal(true);
    expect(s.reserveBufferBps).to.equal(1_000);
    expect(s.maxPerCycleUsdc.toNumber()).to.equal(5_000_000_000);
    expect(s.maxDeviationBps).to.equal(500);
    expect(s.anchorMoveBps).to.equal(200);
    expect(s.icePerUsdcAnchor.toNumber()).to.equal(0);
    expect(s.paused).to.equal(false);
    expect(s.authBump).to.equal(authBump);
    expect(s.totalUsdcOut.toNumber()).to.equal(0);
    expect(s.totalIceBurned.toNumber()).to.equal(0);

    const a = initAccounts();
    const usdc = await getAccount(connection, a.bbUsdc);
    expect(usdc.owner.equals(bbAuth)).to.equal(true);
    expect(usdc.mint.equals(usdcMint)).to.equal(true);
    const ice = await getAccount(connection, a.bbIce);
    expect(ice.owner.equals(bbAuth)).to.equal(true);
    expect(ice.mint.equals(iceMint)).to.equal(true);
  });

  it("initialize cannot run twice", async () => {
    let threw = false;
    try {
      await program.methods.initialize(initArgs()).accountsPartial(initAccounts()).rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it("set_params is admin-only and validates its inputs", async () => {
    const setParams = (signer: Keypair, overrides: Record<string, unknown>) =>
      program.methods
        .setParams(params(overrides))
        .accountsPartial({ admin: signer.publicKey, state: statePda })
        .signers(signer === admin ? [] : [signer])
        .rpc();

    await expectAnchorError(setParams(stranger, { paused: true }), "Unauthorized");
    await expectAnchorError(setParams(admin, { reserveBufferBps: 10_000 }), "InvalidBps");
    await expectAnchorError(setParams(admin, { maxDeviationBps: 10_000 }), "InvalidBps");
    await expectAnchorError(setParams(admin, { keepers: Array.from({ length: 9 }, () => Keypair.generate().publicKey) }), "TooManyKeepers");

    const keeper = Keypair.generate().publicKey;
    const jup = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    await setParams(admin, {
      swapProgram: jup,
      reserveBufferBps: 2_000,
      maxPerCycleUsdc: new BN(42),
      minIntervalSecs: 600,
      icePerUsdcAnchor: new BN(123_456),
      paused: true,
      keepers: [keeper],
    });
    let s = await program.account.buybackState.fetch(statePda);
    expect(s.swapProgram.equals(jup)).to.equal(true);
    expect(s.reserveBufferBps).to.equal(2_000);
    expect(s.maxPerCycleUsdc.toNumber()).to.equal(42);
    expect(s.minIntervalSecs).to.equal(600);
    expect(s.icePerUsdcAnchor.toNumber()).to.equal(123_456);
    expect(s.paused).to.equal(true);
    expect(s.keeperCount).to.equal(1);
    expect(s.keepers[0].equals(keeper)).to.equal(true);
    // untouched fields stay
    expect(s.feeRouter.equals(feeRouterId)).to.equal(true);

    // admin rotation: old admin loses access, new admin can rotate back
    const newAdmin = Keypair.generate();
    await setParams(admin, { newAdmin: newAdmin.publicKey });
    await expectAnchorError(setParams(admin, { paused: false }), "Unauthorized");
    await setParams(newAdmin, { newAdmin: admin.publicKey, paused: false });
    s = await program.account.buybackState.fetch(statePda);
    expect(s.admin.equals(admin.publicKey)).to.equal(true);
    expect(s.paused).to.equal(false);
  });
});
