/**
 * Distributor end-to-end on localnet (no fee_router / DBC needed):
 * open_epoch is funded in "direct mode" from a plain keypair-owned COIN account, then
 * push_payouts → finalize_epoch (Merkle root from tests/merkle.ts) → claim.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

import type { Distributor } from "../target/types/distributor";
import { buildTree, getProofForWallet, proofToArgs, toArray32 } from "./merkle";

const DIST_SEED = Buffer.from("dist");
const EPOCH_SEED = Buffer.from("epoch");
const CLAIMED_SEED = Buffer.from("claimed");
const DIST_AUTH_SEED = Buffer.from("dist_auth");

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

async function expectError(p: Promise<unknown>, needle?: string): Promise<void> {
  try {
    await p;
  } catch (e: any) {
    if (needle) {
      const s = `${e?.error?.errorCode?.code ?? ""} ${e?.message ?? ""} ${(e?.logs ?? []).join("\n")}`;
      assert.include(s, needle, `expected error containing "${needle}", got: ${s}`);
    }
    return;
  }
  assert.fail(`expected transaction to fail${needle ? ` with ${needle}` : ""}`);
}

describe("distributor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Distributor as Program<Distributor>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const [distConfig] = PublicKey.findProgramAddressSync([DIST_SEED], program.programId);
  const [distAuth] = PublicKey.findProgramAddressSync([DIST_AUTH_SEED], program.programId);

  // Fake fee_router id: only used for the sweep treasury derivation (not exercised here).
  const feeRouterId = new PublicKey("FeeRoutr111111111111111111111111111111111111");

  const funder = Keypair.generate();
  const w1 = Keypair.generate(); // push
  const w2 = Keypair.generate(); // push
  const w3 = Keypair.generate(); // claim (no ATA beforehand)
  const w4 = Keypair.generate(); // claim
  const pool = Keypair.generate().publicKey; // stands in for the DBC pool key

  let coinMint: PublicKey;
  let funderAta: PublicKey;
  let epoch: PublicKey;
  let epochVault: PublicKey;
  const index = 0;

  const TOTAL = 1_000_000n;
  const PUSH_EACH = 150_000n;
  const claims = [
    { kp: w3, amount: 300_000n },
    { kp: w4, amount: 200_000n },
    { kp: w1, amount: 100_000n }, // w1 got a push AND has a Merkle share
  ];

  async function airdrop(pk: PublicKey, sol = 2) {
    const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  }

  before(async () => {
    for (const k of [funder, w1, w2, w3, w4]) await airdrop(k.publicKey);
    coinMint = await createMint(conn, admin, admin.publicKey, null, 6);
    funderAta = await createAssociatedTokenAccount(conn, admin, coinMint, funder.publicKey);
    await mintTo(conn, admin, coinMint, funderAta, admin, TOTAL * 2n);
    await createAssociatedTokenAccount(conn, admin, coinMint, w1.publicKey);
    await createAssociatedTokenAccount(conn, admin, coinMint, w2.publicKey);

    [epoch] = PublicKey.findProgramAddressSync([EPOCH_SEED, pool.toBuffer(), u32le(index)], program.programId);
    epochVault = getAssociatedTokenAddressSync(coinMint, epoch, true);
  });

  it("initialize (idempotent across test files)", async () => {
    const existing = await program.account.distConfig.fetchNullable(distConfig);
    if (!existing) {
      await program.methods
        .initialize(feeRouterId, 10_000)
        .accountsPartial({ payer: admin.publicKey, distConfig, systemProgram: SystemProgram.programId })
        .rpc();
    }
    const cfg = await program.account.distConfig.fetch(distConfig);
    assert.ok(cfg.admin.equals(admin.publicKey));
  });

  it("open_epoch rejects non-keepers", async () => {
    const rogue = Keypair.generate();
    await airdrop(rogue.publicKey);
    const [e] = PublicKey.findProgramAddressSync([EPOCH_SEED, pool.toBuffer(), u32le(99)], program.programId);
    await expectError(
      program.methods
        .openEpoch({
          pool,
          index: 99,
          startTs: new BN(0),
          endTs: new BN(1),
          totalAmount: new BN(1),
          eligibleHolders: 1,
          twabTotal: new BN(1),
        })
        .accountsPartial({
          keeper: rogue.publicKey,
          distConfig,
          epoch: e,
          coinMint,
          epochVault: getAssociatedTokenAddressSync(coinMint, e, true),
          sourceVault: funderAta,
          sourceAuthority: funder.publicKey,
          distAuth,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rogue, funder])
        .rpc(),
      "Unauthorized",
    );
  });

  it("open_epoch (direct mode) funds the epoch vault", async () => {
    const now = Math.floor(Date.now() / 1000);
    await program.methods
      .openEpoch({
        pool,
        index,
        startTs: new BN(now - 900),
        endTs: new BN(now),
        totalAmount: new BN(TOTAL.toString()),
        eligibleHolders: 5,
        twabTotal: new BN("123456789000"),
      })
      .accountsPartial({
        keeper: admin.publicKey,
        distConfig,
        epoch,
        coinMint,
        epochVault,
        sourceVault: funderAta,
        sourceAuthority: funder.publicKey,
        distAuth,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([funder])
      .rpc();

    const e = await program.account.epoch.fetch(epoch);
    assert.equal(e.totalAmount.toString(), TOTAL.toString());
    assert.equal(e.index, index);
    assert.isFalse(e.finalized);
    assert.equal((await getAccount(conn, epochVault)).amount, TOTAL);
  });

  const pushAccounts = () => ({
    keeper: admin.publicKey,
    distConfig,
    epoch,
    coinMint,
    epochVault,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  it("push_payouts rejects a destination not owned by the wallet", async () => {
    const w2Ata = getAssociatedTokenAddressSync(coinMint, w2.publicKey);
    await expectError(
      program.methods
        .pushPayouts([{ wallet: w1.publicKey, amount: new BN(1) }])
        .accountsPartial(pushAccounts())
        .remainingAccounts([{ pubkey: w2Ata, isSigner: false, isWritable: true }])
        .rpc(),
      "InvalidDestination",
    );
  });

  it("push_payouts pays existing ATAs", async () => {
    const dests = [w1, w2].map((k) => getAssociatedTokenAddressSync(coinMint, k.publicKey));
    await program.methods
      .pushPayouts([
        { wallet: w1.publicKey, amount: new BN(PUSH_EACH.toString()) },
        { wallet: w2.publicKey, amount: new BN(PUSH_EACH.toString()) },
      ])
      .accountsPartial(pushAccounts())
      .remainingAccounts(dests.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
      .rpc();

    for (const d of dests) assert.equal((await getAccount(conn, d)).amount, PUSH_EACH);
    const e = await program.account.epoch.fetch(epoch);
    assert.equal(e.pushedAmount.toString(), (PUSH_EACH * 2n).toString());
  });

  let tree: ReturnType<typeof buildTree>;

  it("finalize_epoch posts the Merkle root", async () => {
    tree = buildTree(
      epoch,
      claims.map((c) => ({ wallet: c.kp.publicKey, amount: c.amount })),
    );
    await program.methods
      .finalizeEpoch(toArray32(tree.root), new BN(tree.total.toString()))
      .accountsPartial({ keeper: admin.publicKey, distConfig, epoch })
      .rpc();
    const e = await program.account.epoch.fetch(epoch);
    assert.isTrue(e.finalized);
    assert.deepEqual(Buffer.from(e.merkleRoot), tree.root);
  });

  it("push_payouts fails after finalize", async () => {
    await expectError(
      program.methods
        .pushPayouts([{ wallet: w1.publicKey, amount: new BN(1) }])
        .accountsPartial(pushAccounts())
        .remainingAccounts([
          { pubkey: getAssociatedTokenAddressSync(coinMint, w1.publicKey), isSigner: false, isWritable: true },
        ])
        .rpc(),
      "AlreadyFinalized",
    );
  });

  const claimAccounts = (wallet: PublicKey) => ({
    wallet,
    distConfig,
    epoch,
    claimed: PublicKey.findProgramAddressSync([CLAIMED_SEED, epoch.toBuffer(), wallet.toBuffer()], program.programId)[0],
    coinMint,
    epochVault,
    walletAta: getAssociatedTokenAddressSync(coinMint, wallet),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });

  it("claim rejects a wrong amount (bad proof)", async () => {
    const { amount, proof } = getProofForWallet(tree, w4.publicKey);
    await expectError(
      program.methods
        .claim(new BN((amount + 1n).toString()), proofToArgs(proof))
        .accountsPartial(claimAccounts(w4.publicKey))
        .signers([w4])
        .rpc(),
      "InvalidProof",
    );
  });

  it("claim rejects someone else's proof", async () => {
    const { amount, proof } = getProofForWallet(tree, w3.publicKey);
    await expectError(
      program.methods
        .claim(new BN(amount.toString()), proofToArgs(proof))
        .accountsPartial(claimAccounts(w2.publicKey))
        .signers([w2])
        .rpc(),
      "InvalidProof",
    );
  });

  it("claim pays every Merkle entry (creating the ATA when missing)", async () => {
    for (const c of claims) {
      const { amount, proof } = getProofForWallet(tree, c.kp.publicKey);
      const ata = getAssociatedTokenAddressSync(coinMint, c.kp.publicKey);
      const before = (await conn.getAccountInfo(ata)) ? (await getAccount(conn, ata)).amount : 0n;
      await program.methods
        .claim(new BN(amount.toString()), proofToArgs(proof))
        .accountsPartial(claimAccounts(c.kp.publicKey))
        .signers([c.kp])
        .rpc();
      assert.equal((await getAccount(conn, ata)).amount - before, c.amount);
    }
    const e = await program.account.epoch.fetch(epoch);
    assert.equal(e.claimedAmount.toString(), tree.total.toString());
    // remainder left for sweep = total - pushed - merkle_total
    assert.equal((await getAccount(conn, epochVault)).amount, TOTAL - PUSH_EACH * 2n - tree.total);
  });

  it("double claim fails (Claimed PDA already exists)", async () => {
    const { amount, proof } = getProofForWallet(tree, w3.publicKey);
    await expectError(
      program.methods
        .claim(new BN(amount.toString()), proofToArgs(proof))
        .accountsPartial(claimAccounts(w3.publicKey))
        .signers([w3])
        .rpc(),
    );
  });

  it("sweep_unclaimed is blocked before end_ts + 180d", async () => {
    const treasury = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), coinMint.toBuffer()],
      feeRouterId,
    )[0];
    await expectError(
      program.methods
        .sweepUnclaimed()
        .accountsPartial({
          admin: admin.publicKey,
          distConfig,
          epoch,
          coinMint,
          epochVault,
          treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  });
});
