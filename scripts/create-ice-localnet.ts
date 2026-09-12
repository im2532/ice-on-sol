#!/usr/bin/env tsx
/**
 * Localnet / devnet stand-in for the stonk.fun $ICE launch (CONTRACTS §4a):
 *   1. creates the $ICE mint (1 B supply, 6 dp) + Metaplex-free (plain SPL) — the real token comes from stonk.fun
 *   2. creates a DAMM v2 ICE/USDC customizable pool (the buyback's swap venue on localnet; Jupiter on mainnet)
 *   3. buyback.initialize with swap_program = DAMM v2, keepers = KEEPER_PUBKEYS, and
 *      peg_desk.set_redeem_cap_exempt(bb_auth)
 *   4. writes ice mint / pool into deployments/<cluster>.json (`ice` key) and prints the keeper env
 *
 * Idempotent: an existing BuybackState is left alone (re-run with RESET_ICE=1 to rotate the mint/pool).
 * Env: RPC_URL, ADMIN_KEYPAIR_PATH, SOLANA_CLUSTER, BUYBACK_PROGRAM_ID, FEE_ROUTER_PROGRAM_ID, PEG_DESK_PROGRAM_ID,
 *      [KEEPER_PUBKEYS], [USDC_MINT_OVERRIDE], [ICE_POOL_USDC=10000] [ICE_POOL_ICE=10000000] (initial liquidity),
 *      [IDL_DIR]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { BaseFeeMode, CpAmm, getBaseFeeParams, getSqrtPriceFromPrice, MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "@meteora-ag/cp-amm-sdk";
import { parseCluster, usdcMintFor } from "@icemarkets/registry";
import { DAMM_V2_PROGRAM_ID, buyback as buybackPda, pegDesk as pegDeskPda, programDataPda } from "@icemarkets/sdk";

const ONE = 1_000_000n;

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const ids = {
    buyback: new PublicKey(requireEnv("BUYBACK_PROGRAM_ID")),
    feeRouter: new PublicKey(requireEnv("FEE_ROUTER_PROGRAM_ID")),
    pegDesk: new PublicKey(requireEnv("PEG_DESK_PROGRAM_ID")),
  };
  const usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE));
  const withAddress = (idl: any, address: PublicKey) => ({ ...idl, address: address.toBase58() });
  const buyback = new Program(withAddress(loadIdl("buyback"), ids.buyback), provider) as any;
  const pegDesk = new Program(withAddress(loadIdl("peg_desk"), ids.pegDesk), provider) as any;

  const depFile = path.join(process.cwd(), "deployments", `${cluster}.json`);
  const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : { cluster, commodities: [] };
  const statePda = buybackPda.state(ids.buyback)[0];
  const bbAuth = buybackPda.authority(ids.buyback)[0];

  if ((await connection.getAccountInfo(statePda)) && process.env.RESET_ICE !== "1" && dep.ice) {
    console.log(`buyback already initialized; ICE ${dep.ice.mint} pool ${dep.ice.dammPool} (RESET_ICE=1 to redo)`);
    return;
  }

  // 1. $ICE mint — 1 B supply to admin (stonk.fun does this on mainnet).
  const iceMint = await createMint(connection, admin, admin.publicKey, null, 6);
  const adminIce = (await getOrCreateAssociatedTokenAccount(connection, admin, iceMint, admin.publicKey)).address;
  await mintTo(connection, admin, iceMint, adminIce, admin, 1_000_000_000n * ONE);
  const adminUsdc = getAssociatedTokenAddressSync(usdcMint, admin.publicKey);
  console.log(`ICE mint ${iceMint.toBase58()} (1B to admin)`);

  // 2. DAMM v2 ICE/USDC pool. Price = USDC per ICE: ICE_POOL_USDC / ICE_POOL_ICE (default $0.001).
  const usdcAmt = BigInt(process.env.ICE_POOL_USDC ?? "10000") * ONE;
  const iceAmt = BigInt(process.env.ICE_POOL_ICE ?? "10000000") * ONE;
  const cpAmm = new CpAmm(connection);
  // cp-amm orders mints: tokenA < tokenB by bytes ("getFirstKey/getSecondKey"); let the SDK helpers decide.
  const [tokenA, tokenB, amtA, amtB] = iceMint.toBuffer().compare(usdcMint.toBuffer()) < 0 ? [iceMint, usdcMint, iceAmt, usdcAmt] : [usdcMint, iceMint, usdcAmt, iceAmt];
  const price = Number(amtB) / Number(amtA); // B per A, both 6 dp
  const initSqrtPrice = getSqrtPriceFromPrice(price.toString(), 6, 6);
  const { liquidityDelta } = cpAmm.preparePoolCreationParams({
    tokenAAmount: new BN(amtA.toString()),
    tokenBAmount: new BN(amtB.toString()),
    minSqrtPrice: MIN_SQRT_PRICE,
    maxSqrtPrice: MAX_SQRT_PRICE,
  } as any);
  const positionNft = Keypair.generate();
  const { tx: poolTx, pool } = await cpAmm.createCustomPool({
    payer: admin.publicKey,
    creator: admin.publicKey,
    positionNft: positionNft.publicKey,
    tokenAMint: tokenA,
    tokenBMint: tokenB,
    tokenAAmount: new BN(amtA.toString()),
    tokenBAmount: new BN(amtB.toString()),
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta,
    initSqrtPrice,
    poolFees: {
      baseFee: getBaseFeeParams({
        baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
        feeTimeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
      }),
      compoundingFeeBps: 0,
      padding: 0,
      dynamicFee: null,
    },
    hasAlphaVault: false,
    activationType: 1, // timestamp
    collectFeeMode: 0,
    activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: false,
  });
  poolTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  await sendAndConfirmTransaction(connection, poolTx, [admin, positionNft], { commitment: "confirmed" });
  console.log(`DAMM v2 ICE/USDC pool ${pool.toBase58()} (${Number(usdcAmt) / 1e6} USDC / ${Number(iceAmt) / 1e6} ICE)`);
  void adminUsdc;

  // 3. buyback.initialize + peg_desk exemption
  // Initial rate anchor (audit F-02): ICE base units per 1 USDC at the pool's spot price, discounted by
  // the 1% pool fee so the first real cycle lands inside max_deviation_bps. Override with BUYBACK_ANCHOR
  // (ICE per USDC, whole tokens) when seeding against a pool created elsewhere. Downward repricing later
  // is an admin set_params; the program only ratchets the anchor upward on its own.
  const icePerUsdcAnchor = process.env.BUYBACK_ANCHOR
    ? new BN(Math.round(Number(process.env.BUYBACK_ANCHOR) * 1e6))
    : new BN(((iceAmt * ONE * 99n) / (usdcAmt * 100n)).toString());
  const keepers = (process.env.KEEPER_PUBKEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => new PublicKey(s));
  if (!(await connection.getAccountInfo(statePda))) {
    const sig = await buyback.methods
      .initialize({
        feeRouter: ids.feeRouter,
        pegDesk: ids.pegDesk,
        swapProgram: DAMM_V2_PROGRAM_ID,
        reserveBufferBps: 200,
        maxPerCycleUsdc: new BN(Number(process.env.BUYBACK_MAX_PER_CYCLE_USDC ?? 2_000) * 1e6),
        maxDeviationBps: 500,
        anchorMoveBps: 200,
        minIntervalSecs: Number(process.env.BUYBACK_MIN_INTERVAL ?? 60),
        icePerUsdcAnchor,
      })
      .accountsPartial({
        admin: admin.publicKey,
        program: ids.buyback,
        programData: programDataPda(ids.buyback),
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
      })
      .rpc();
    console.log(`buyback.initialize ${statePda.toBase58()} anchor=${icePerUsdcAnchor.toString()} ICE-base/USDC (${sig})`);
  } else {
    await buyback.methods
      .setParams({ feeRouter: null, pegDesk: null, swapProgram: null, reserveBufferBps: null, maxPerCycleUsdc: null, maxDeviationBps: null, anchorMoveBps: null, minIntervalSecs: null, icePerUsdcAnchor, paused: null, keepers: null, newAdmin: null })
      .accountsPartial({ admin: admin.publicKey, state: statePda })
      .rpc();
    console.warn(`buyback state existed: anchor re-set to ${icePerUsdcAnchor.toString()} ICE-base/USDC; ice_mint/usdc_mint cannot change without RESET (close + re-init)`);
  }
  if (keepers.length > 0) {
    await buyback.methods
      .setParams({ feeRouter: null, pegDesk: null, swapProgram: null, reserveBufferBps: null, maxPerCycleUsdc: null, maxDeviationBps: null, anchorMoveBps: null, minIntervalSecs: null, icePerUsdcAnchor: null, paused: null, keepers, newAdmin: null })
      .accountsPartial({ admin: admin.publicKey, state: statePda })
      .rpc();
    console.log(`buyback keepers: ${keepers.map((k) => k.toBase58()).join(", ")}`);
  }
  const sigX = await pegDesk.methods
    .setRedeemCapExempt(bbAuth)
    .accountsPartial({ admin: admin.publicKey, config: pegDeskPda.config(ids.pegDesk)[0] })
    .rpc();
  console.log(`peg_desk.set_redeem_cap_exempt(${bbAuth.toBase58()}) (${sigX})`);

  // 4. deployments file + env hints
  dep.ice = { mint: iceMint.toBase58(), dammPool: pool.toBase58(), swapProgram: DAMM_V2_PROGRAM_ID.toBase58(), createdAt: new Date().toISOString() };
  writeFileSync(depFile, JSON.stringify(dep, null, 2) + "\n");
  console.log(`\nwrote ${depFile}#ice\nkeeper env:\n  BUYBACK_ROUTE=damm\n  BUYBACK_DAMM_POOL=${pool.toBase58()}\n  BUYBACK_MIN_USD=1`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadIdl(name: string): any {
  const file = path.join(process.env.IDL_DIR ?? path.join(process.cwd(), "target", "idl"), `${name}.json`);
  if (!existsSync(file)) throw new Error(`IDL not found at ${file} — run \`anchor build\` first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
