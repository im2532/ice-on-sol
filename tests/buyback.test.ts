/**
 * buyback on localnet: state initialisation, work-ATA ownership by the bb_auth PDA, and the
 * admin/keeper parameter surface. `convert_and_burn` needs a live DAMM v2 ICE/GLD pool and is
 * exercised on devnet (docs/MAINNET_PLAN.md §1).
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
  return { icePool: null, feeRouter: null, reserveBufferBps: null, maxPerCycle: null, paused: null, keepers: null, newAdmin: null, ...overrides };
}

describe("buyback", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const ws = anchor.workspace as any;
  const program = ws.Buyback as any;
  const feeRouterId: PublicKey = ws.FeeRouter.programId;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], program.programId);
  const [bbAuth, authBump] = PublicKey.findProgramAddressSync([BB_AUTH_SEED], program.programId);
  const stranger = Keypair.generate();
  const icePool = Keypair.generate().publicKey; // stands in for the DAMM v2 pool key
  let iceMint: PublicKey;
  let gldMint: PublicKey;

  const initAccounts = () => ({
    admin: admin.publicKey,
    state: statePda,
    bbAuth,
    iceMint,
    gldMint,
    bbGld: getAssociatedTokenAddressSync(gldMint, bbAuth, true),
    bbIcemarkets: getAssociatedTokenAddressSync(iceMint, bbAuth, true),
    gldTokenProgram: TOKEN_PROGRAM_ID,
    iceTokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });

  before(async () => {
    const sig = await connection.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    iceMint = await createMint(connection, admin, admin.publicKey, null, 6);
    gldMint = await createMint(connection, admin, admin.publicKey, null, 6);
  });

  it("initialize rejects a reserve buffer of 100% or more", async () => {
    await expectAnchorError(
      program.methods
        .initialize({ feeRouter: feeRouterId, icePool, reserveBufferBps: 10_000, maxPerCycle: new BN(1_000_000) })
        .accountsPartial(initAccounts())
        .rpc(),
      "InvalidBps",
    );
  });

  it("initialize creates the state and both work ATAs owned by bb_auth", async () => {
    await program.methods
      .initialize({ feeRouter: feeRouterId, icePool, reserveBufferBps: 1_000, maxPerCycle: new BN(5_000_000) })
      .accountsPartial(initAccounts())
      .rpc();
    const s = await program.account.buybackState.fetch(statePda);
    expect(s.admin.equals(admin.publicKey)).to.equal(true);
    expect(s.feeRouter.equals(feeRouterId)).to.equal(true);
    expect(s.iceMint.equals(iceMint)).to.equal(true);
    expect(s.gldMint.equals(gldMint)).to.equal(true);
    expect(s.icePool.equals(icePool)).to.equal(true);
    expect(s.reserveBufferBps).to.equal(1_000);
    expect(s.maxPerCycle.toNumber()).to.equal(5_000_000);
    expect(s.paused).to.equal(false);
    expect(s.authBump).to.equal(authBump);
    expect(s.totalGldIn.toNumber()).to.equal(0);
    expect(s.totalIceBurned.toNumber()).to.equal(0);

    const a = initAccounts();
    const gld = await getAccount(connection, a.bbGld);
    expect(gld.owner.equals(bbAuth)).to.equal(true);
    expect(gld.mint.equals(gldMint)).to.equal(true);
    const ice = await getAccount(connection, a.bbIcemarkets);
    expect(ice.owner.equals(bbAuth)).to.equal(true);
    expect(ice.mint.equals(iceMint)).to.equal(true);
  });

  it("initialize cannot run twice", async () => {
    let threw = false;
    try {
      await program.methods
        .initialize({ feeRouter: feeRouterId, icePool, reserveBufferBps: 1_000, maxPerCycle: new BN(1) })
        .accountsPartial(initAccounts())
        .rpc();
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
    await expectAnchorError(setParams(admin, { keepers: Array.from({ length: 9 }, () => Keypair.generate().publicKey) }), "TooManyKeepers");

    const keeper = Keypair.generate().publicKey;
    const newPool = Keypair.generate().publicKey;
    await setParams(admin, { icePool: newPool, reserveBufferBps: 2_000, maxPerCycle: new BN(42), paused: true, keepers: [keeper] });
    let s = await program.account.buybackState.fetch(statePda);
    expect(s.icePool.equals(newPool)).to.equal(true);
    expect(s.reserveBufferBps).to.equal(2_000);
    expect(s.maxPerCycle.toNumber()).to.equal(42);
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
