/**
 * peg_desk integration tests (localnet via `anchor test`).
 *
 * Uses a KeeperSigned GLD market so no Pyth accounts are needed. Metaplex Token Metadata must be
 * available on the validator — Anchor.toml clones it from mainnet ([[test.validator.clone]]).
 *
 * The IDL/types are not generated yet, so the program is used as `any`.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

const BN = anchor.BN;

// ---- constants mirrored from programs/peg_desk/src/constants.rs ----------------------------
const SEED = {
  config: Buffer.from("config"),
  commodity: Buffer.from("cmdty"),
  reserve: Buffer.from("reserve"),
  keeperPrice: Buffer.from("kp"),
  mintAuth: Buffer.from("mint_auth"),
};
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const USD = 100_000_000; // 1e8
const ONE = 1_000_000; // 1 token at 6 decimals
const ORACLE_KEEPER_SIGNED = 2;
const SESSION_CONTINUOUS = 0;
const STATUS = { Open: 0, Closed: 1, Halted: 2 };

const GLD_PRICE = 2_000 * USD; // $2,000.00

function symbolBytes(s: string): number[] {
  const b = Buffer.alloc(12);
  b.write(s, "ascii");
  return Array.from(b);
}

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** ProgramData PDA of an upgradeable program (audit F-09 init gate; ignored on genesis-loaded programs). */
function programDataPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
}

/** Asserts the promise rejects with the given Anchor error name (e.g. "StaleOracle"). */
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

/** All-None SetParamsArgs; override the fields you want to set. */
function params(overrides: Record<string, unknown>) {
  return {
    sessionKind: null,
    feedId: null,
    fxFeedId: null,
    quoteScale: null,
    baseSpreadBps: null,
    closedSpreadBps: null,
    confMultBps: null,
    maxAgeOpen: null,
    maxAgeClosed: null,
    supplyCap: null,
    perTxCap: null,
    pythMinSignatures: null,
    dailyMintCap: null,
    dailyRedeemCap: null,
    maxDeviationBps: null,
    deviationWindowSecs: null,
    ...overrides,
  };
}

describe("peg_desk", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = (anchor.workspace as any).PegDesk as any;
  const connection = provider.connection;
  const adminWallet = provider.wallet as anchor.Wallet;
  const admin = adminWallet.payer;

  const keeper = Keypair.generate();
  const user = Keypair.generate();
  const treasuryOwner = Keypair.generate();
  const gldMint = Keypair.generate();

  const configPda = pda([SEED.config], program.programId);
  const mintAuth = pda([SEED.mintAuth], program.programId);
  const gldSymbol = symbolBytes("GLD");
  const gldPda = pda([SEED.commodity, Buffer.from(gldSymbol)], program.programId);
  const reserveVault = pda([SEED.reserve, gldPda.toBuffer()], program.programId);
  const keeperPricePda = pda([SEED.keeperPrice, gldPda.toBuffer()], program.programId);
  const metadataPda = pda(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), gldMint.publicKey.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );

  let usdcMint: PublicKey;
  let userUsdc: PublicKey;
  let userCoin: PublicKey;
  let adminUsdc: PublicKey;
  let treasuryUsdc: PublicKey;
  let lastPushed = 0;
  let lastPushChain = 0;

  // ---- helpers ------------------------------------------------------------------------------

  async function chainNow(): Promise<number> {
    const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    // Clock: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64
    return Number(info!.data.readBigInt64LE(32));
  }

  async function balance(ata: PublicKey): Promise<bigint> {
    return (await getAccount(connection, ata)).amount;
  }

  let lastPushWall = 0;
  let boundsSet = false;
  /**
   * Keeper posts a price; publish_time strictly increases across calls. Posts are rate-limited on
   * the validator clock (audit F-05): the first post creates the KeeperPrice with the 30 s default,
   * which the suite immediately lowers to 1 s, and the helper waits out that second between posts.
   */
  async function pushPrice(price: number, opts: { publishTime?: number; conf?: number } = {}) {
    if (boundsSet) {
      // The rate limit runs on the validator clock, which can lag the wall clock under load: wait until
      // chain time has actually moved past the previous post by min_interval (1 s), not a wall-clock 1.2 s.
      const wait = 1_200 - (Date.now() - lastPushWall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      while ((await chainNow()) < lastPushChain + 1) await new Promise((r) => setTimeout(r, 250));
    }
    const now = await chainNow();
    const publishTime = opts.publishTime ?? Math.max(now, lastPushed + 1);
    await program.methods
      .keeperUpdatePrice(new BN(price), new BN(opts.conf ?? 0), new BN(publishTime), Array(32).fill(7))
      .accountsPartial({
        keeper: keeper.publicKey,
        config: configPda,
        commodity: gldPda,
        keeperPrice: keeperPricePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([keeper])
      .rpc();
    lastPushed = Math.max(lastPushed, publishTime);
    lastPushWall = Date.now();
    lastPushChain = (await program.account.keeperPrice.fetch(keeperPricePda)).lastUpdateTs.toNumber();
    if (!boundsSet) {
      boundsSet = true;
      await program.methods
        .setKeeperBounds(500, 1)
        .accountsPartial({ admin: admin.publicKey, config: configPda, commodity: gldPda, keeperPrice: keeperPricePda })
        .rpc();
    }
  }

  function tradeAccounts() {
    return {
      user: user.publicKey,
      config: configPda,
      commodity: gldPda,
      coinMint: gldMint.publicKey,
      mintAuth,
      reserveVault,
      userUsdc,
      userCoin,
      priceFeed: null,
      fxFeed: null,
      keeperPrice: keeperPricePda,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  const buy = (usdcIn: number, minCoinOut = 0) =>
    program.methods
      .buy(new BN(usdcIn), new BN(minCoinOut))
      .accountsPartial(tradeAccounts())
      .signers([user])
      .rpc();

  const sell = (coinIn: number, minUsdcOut = 0) =>
    program.methods
      .sell(new BN(coinIn), new BN(minUsdcOut))
      .accountsPartial(tradeAccounts())
      .signers([user])
      .rpc();

  const setStatus = (signer: Keypair, status: number) =>
    program.methods
      .setStatus(status)
      .accountsPartial({ authority: signer.publicKey, config: configPda, commodity: gldPda })
      .signers(signer === admin ? [] : [signer])
      .rpc();

  const setParams = (overrides: Record<string, unknown>) =>
    program.methods
      .setCommodityParams(params(overrides))
      .accountsPartial({ authority: admin.publicKey, config: configPda, commodity: gldPda })
      .rpc();

  const sweep = (amount: number) =>
    program.methods
      .sweepSpreadFees(new BN(amount))
      .accountsPartial({
        authority: keeper.publicKey,
        config: configPda,
        commodity: gldPda,
        coinMint: gldMint.publicKey,
        reserveVault,
        treasuryUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([keeper])
      .rpc();

  // ---- setup ----------------------------------------------------------------------------------

  before(async () => {
    const sig = await connection.requestAirdrop(keeper.publicKey, 2 * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");

    usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
    userUsdc = (await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, user.publicKey)).address;
    adminUsdc = (await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, admin.publicKey)).address;
    treasuryUsdc = (await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, treasuryOwner.publicKey))
      .address;
    await mintTo(connection, admin, usdcMint, userUsdc, admin, 100_000 * ONE);
    await mintTo(connection, admin, usdcMint, adminUsdc, admin, 100_000 * ONE);
  });

  // ---- tests ----------------------------------------------------------------------------------

  it("initializes the global config and keeper set", async () => {
    await program.methods
      .initializeConfig(200, 10_200, 9_800)
      .accountsPartial({
        payer: admin.publicKey,
        config: configPda,
        reserveMint: usdcMint,
        treasury: treasuryOwner.publicKey,
        program: program.programId,
        programData: programDataPda(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .setKeepers([keeper.publicKey])
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();

    const cfg = await program.account.globalConfig.fetch(configPda);
    expect(cfg.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(cfg.reserveMint.toBase58()).to.equal(usdcMint.toBase58());
    expect(cfg.treasury.toBase58()).to.equal(treasuryOwner.publicKey.toBase58());
    expect(cfg.keeperCount).to.equal(1);
    expect(cfg.keepers[0].toBase58()).to.equal(keeper.publicKey.toBase58());
    expect(cfg.maxConfBps).to.equal(200);
    expect(cfg.reserveWarnBps).to.equal(10_200);
    expect(cfg.reserveHaltBps).to.equal(9_800);
    expect(cfg.globalPause).to.equal(false);
  });

  it("keeper may pause but only admin may unpause", async () => {
    await program.methods
      .setGlobalPause(true)
      .accountsPartial({ authority: keeper.publicKey, config: configPda })
      .signers([keeper])
      .rpc();
    await expectAnchorError(
      program.methods
        .setGlobalPause(false)
        .accountsPartial({ authority: keeper.publicKey, config: configPda })
        .signers([keeper])
        .rpc(),
      "Unauthorized",
    );
    await program.methods
      .setGlobalPause(false)
      .accountsPartial({ authority: admin.publicKey, config: configPda })
      .rpc();
    expect((await program.account.globalConfig.fetch(configPda)).globalPause).to.equal(false);
  });

  it("creates GLD with a KeeperSigned oracle, PDA mint authority and no freeze authority", async () => {
    const args = {
      symbol: gldSymbol,
      oracleKind: ORACLE_KEEPER_SIGNED,
      sessionKind: SESSION_CONTINUOUS,
      feedId: Array(32).fill(0),
      feedAccount: PublicKey.default,
      fxFeedId: Array(32).fill(0),
      fxFeedAccount: PublicKey.default,
      quoteScale: 0,
      baseSpreadBps: 10,
      closedSpreadBps: 150,
      confMultBps: 50,
      maxAgeOpen: 60,
      maxAgeClosed: 3_600,
      supplyCap: new BN(1_000 * ONE),
      perTxCap: new BN(100 * ONE),
      pythMinSignatures: 0,
      name: "ICEmarkets Gold",
      uri: "https://icemarkets.exchange/meta/GLD.json",
    };

    await program.methods
      .createCommodity(args)
      .accountsPartial({
        payer: admin.publicKey,
        admin: admin.publicKey,
        config: configPda,
        mintAuth,
        reserveMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        commodity: gldPda,
        coinMint: gldMint.publicKey,
        reserveVault,
        metadata: metadataPda,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([gldMint])
      .rpc();

    const c = await program.account.commodity.fetch(gldPda);
    expect(Buffer.from(c.symbol).toString("ascii").replace(/\0+$/, "")).to.equal("GLD");
    expect(c.coinMint.toBase58()).to.equal(gldMint.publicKey.toBase58());
    expect(c.reserveVault.toBase58()).to.equal(reserveVault.toBase58());
    expect(c.oracleKind).to.equal(ORACLE_KEEPER_SIGNED);
    expect(c.status).to.equal(STATUS.Open);
    expect(c.decimals).to.equal(6);

    const mint = await getMint(connection, gldMint.publicKey);
    expect(mint.decimals).to.equal(6);
    expect(mint.mintAuthority!.toBase58()).to.equal(mintAuth.toBase58());
    expect(mint.freezeAuthority).to.equal(null);
    expect(Number(mint.supply)).to.equal(0);

    const md = await connection.getAccountInfo(metadataPda);
    expect(md, "metadata account").to.not.equal(null);
    expect(md!.owner.toBase58()).to.equal(TOKEN_METADATA_PROGRAM_ID.toBase58());

    userCoin = (await getOrCreateAssociatedTokenAccount(connection, admin, gldMint.publicKey, user.publicKey)).address;
  });

  it("anyone can seed the reserve", async () => {
    await program.methods
      .depositReserve(new BN(10_000 * ONE))
      .accountsPartial({
        depositor: admin.publicKey,
        commodity: gldPda,
        reserveVault,
        from: adminUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    expect(Number(await balance(reserveVault))).to.equal(10_000 * ONE);
    const c = await program.account.commodity.fetch(gldPda);
    expect(c.reserveBalanceCached.toNumber()).to.equal(10_000 * ONE);
  });

  it("rejects a buy on a stale oracle", async () => {
    const now = await chainNow();
    await pushPrice(GLD_PRICE, { publishTime: now - 1_000 }); // max_age_open = 60
    await expectAnchorError(buy(2_002 * ONE), "StaleOracle");
  });

  it("buys at oracle + spread and mints COIN", async () => {
    await pushPrice(GLD_PRICE);
    const usdcBefore = await balance(userUsdc);

    // spread = 10 bps (conf 0, fresh, no prior supply) → ask $2,002 → exactly 1 GLD for $2,002
    await buy(2_002 * ONE, 999_000);

    expect(Number(await balance(userCoin))).to.equal(ONE);
    expect(Number(usdcBefore - (await balance(userUsdc)))).to.equal(2_002 * ONE);
    expect(Number(await balance(reserveVault))).to.equal(12_002 * ONE);

    const c = await program.account.commodity.fetch(gldPda);
    expect(c.lastPrice.toNumber()).to.equal(GLD_PRICE);
    expect(c.lastPublishTime.toNumber()).to.equal(lastPushed);
    expect(c.reserveBalanceCached.toNumber()).to.equal(12_002 * ONE);
  });

  it("enforces min_coin_out slippage", async () => {
    await pushPrice(GLD_PRICE);
    await expectAnchorError(buy(2_002 * ONE, ONE + 1), "SlippageExceeded");
  });

  it("sells at oracle − spread, burns COIN, pays from reserve", async () => {
    await pushPrice(GLD_PRICE);
    const usdcBefore = await balance(userUsdc);
    // bid $1,998 → 0.5 GLD pays $999
    await sell(ONE / 2, 998 * ONE);
    expect(Number(await balance(userCoin))).to.equal(ONE / 2);
    expect(Number((await balance(userUsdc)) - usdcBefore)).to.equal(999 * ONE);
    expect(Number((await getMint(connection, gldMint.publicKey)).supply)).to.equal(ONE / 2);
    expect(Number(await balance(reserveVault))).to.equal(11_003 * ONE);
  });

  it("enforces per-tx cap and supply cap", async () => {
    await pushPrice(GLD_PRICE);

    await setParams({ perTxCap: new BN(ONE / 10) }); // 0.1 GLD
    await expectAnchorError(buy(2_002 * ONE), "PerTxCapExceeded");

    // supply is 0.5 GLD; cap at 1.5 GLD, try to mint ~1.2 more (within the 1.5 per-tx cap)
    await setParams({ supplyCap: new BN((3 * ONE) / 2), perTxCap: new BN((3 * ONE) / 2) });
    await expectAnchorError(buy(2_403 * ONE), "SupplyCapExceeded");

    await setParams({ supplyCap: new BN(1_000 * ONE), perTxCap: new BN(100 * ONE) });
  });

  it("Closed is sell-only at closed_spread; keeper cannot reopen a Halted market", async () => {
    await setStatus(keeper, STATUS.Closed);
    await pushPrice(GLD_PRICE);
    await expectAnchorError(buy(100 * ONE), "MarketClosed");

    // closed spread 150 bps → bid $1,970 → 0.1 GLD pays $197
    const usdcBefore = await balance(userUsdc);
    await sell(ONE / 10);
    expect(Number((await balance(userUsdc)) - usdcBefore)).to.equal(197 * ONE);

    await setStatus(keeper, STATUS.Open);

    await setStatus(keeper, STATUS.Halted);
    await pushPrice(GLD_PRICE);
    await expectAnchorError(sell(ONE / 10), "MarketHalted");
    await expectAnchorError(setStatus(keeper, STATUS.Open), "Unauthorized");
    await setStatus(admin, STATUS.Open);
    expect((await program.account.commodity.fetch(gldPda)).status).to.equal(STATUS.Open);
  });

  it("keeper price is monotonic and move-bounded", async () => {
    await pushPrice(GLD_PRICE);
    await expectAnchorError(pushPrice(GLD_PRICE, { publishTime: lastPushed - 5 }), "OracleNotMonotonic");
    await expectAnchorError(pushPrice(GLD_PRICE, { publishTime: lastPushed }), "OracleNotMonotonic");
    // validator-clock rate limit (audit F-05): a second post inside min_interval (1 s) is refused
    // even with a strictly newer publish_time — the keeper cannot pack max-move posts into one slot.
    // A 1 s interval makes this racy against the validator clock (the failed posts above can straddle a
    // chain second); widen it to 30 s for the assertion, then restore.
    await program.methods.setKeeperBounds(500, 30).accountsPartial({ admin: admin.publicKey, config: configPda, commodity: gldPda, keeperPrice: keeperPricePda }).rpc();
    lastPushWall = Date.now();
    await expectAnchorError(
      program.methods
        .keeperUpdatePrice(new BN(GLD_PRICE), new BN(0), new BN(lastPushed + 1), Array(32).fill(7))
        .accountsPartial({ keeper: keeper.publicKey, config: configPda, commodity: gldPda, keeperPrice: keeperPricePda, systemProgram: SystemProgram.programId })
        .signers([keeper])
        .rpc(),
      "TooSoon",
    );
    await program.methods.setKeeperBounds(500, 1).accountsPartial({ admin: admin.publicKey, config: configPda, commodity: gldPda, keeperPrice: keeperPricePda }).rpc();
    await expectAnchorError(
      program.methods.setKeeperBounds(500, 0).accountsPartial({ admin: admin.publicKey, config: configPda, commodity: gldPda, keeperPrice: keeperPricePda }).rpc(),
      "InvalidParams",
    );
    // default max_move_bps = 500 (±5%)
    await expectAnchorError(pushPrice(Math.round(GLD_PRICE * 1.06)), "MoveTooLarge");
    await pushPrice(Math.round(GLD_PRICE * 1.04));
    await pushPrice(GLD_PRICE);

    // non-keeper cannot post
    await expectAnchorError(
      program.methods
        .keeperUpdatePrice(new BN(GLD_PRICE), new BN(0), new BN(lastPushed + 1), Array(32).fill(0))
        .accountsPartial({
          keeper: user.publicKey,
          config: configPda,
          commodity: gldPda,
          keeperPrice: keeperPricePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc(),
      "Unauthorized",
    );
  });

  it("rejects trades while globally paused", async () => {
    await program.methods
      .setGlobalPause(true)
      .accountsPartial({ authority: keeper.publicKey, config: configPda })
      .signers([keeper])
      .rpc();
    await pushPrice(GLD_PRICE);
    await expectAnchorError(sell(ONE / 10), "Paused");
    await program.methods
      .setGlobalPause(false)
      .accountsPartial({ authority: admin.publicKey, config: configPda })
      .rpc();
  });

  it("sweeps spread fees only while the reserve stays ≥ 102%", async () => {
    // Fresh trade so last_price / last_publish_time are within max_age for the sweep check.
    await pushPrice(GLD_PRICE);
    await buy(20 * ONE);

    const vault = Number(await balance(reserveVault));
    const supply = Number((await getMint(connection, gldMint.publicKey)).supply);
    const liability = (supply * GLD_PRICE) / USD; // USDC base units (equal decimals)

    // leaving only ~101% of liability must fail
    const tooMuch = Math.floor(vault - liability * 1.01);
    await expectAnchorError(sweep(tooMuch), "ReserveRatioTooLow");

    const treasuryBefore = await balance(treasuryUsdc);
    await sweep(100 * ONE);
    expect(Number((await balance(treasuryUsdc)) - treasuryBefore)).to.equal(100 * ONE);
    expect(Number(await balance(reserveVault))).to.equal(vault - 100 * ONE);
    const c = await program.account.commodity.fetch(gldPda);
    expect(c.reserveBalanceCached.toNumber()).to.equal(vault - 100 * ONE);

    // non-keeper cannot sweep
    await expectAnchorError(
      program.methods
        .sweepSpreadFees(new BN(1))
        .accountsPartial({
          authority: user.publicKey,
          config: configPda,
          commodity: gldPda,
          coinMint: gldMint.publicKey,
          reserveVault,
          treasuryUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc(),
      "Unauthorized",
    );
  });

  // ---- circuit breakers ---------------------------------------------------------------------

  const clearAnchor = (signer: Keypair) =>
    program.methods
      .clearPriceAnchor()
      .accountsPartial({ authority: signer.publicKey, config: configPda, commodity: gldPda })
      .signers(signer === admin ? [] : [signer])
      .rpc();

  async function waitForChainPast(t: number): Promise<void> {
    for (let i = 0; i < 40; i++) {
      if ((await chainNow()) > t) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`chain clock did not pass ${t}`);
  }

  it("breakers are disabled by default and only the admin may set them", async () => {
    const c = await program.account.commodity.fetch(gldPda);
    expect(c.dailyMintCap.toNumber()).to.equal(0);
    expect(c.dailyRedeemCap.toNumber()).to.equal(0);
    expect(c.maxDeviationBps).to.equal(0);
    expect(c.deviationWindowSecs).to.equal(0);
    expect(c.anchorPrice.toNumber()).to.be.greaterThan(0); // set by the first trade of the suite

    await expectAnchorError(
      program.methods
        .setCommodityParams(params({ dailyMintCap: new BN(ONE) }))
        .accountsPartial({ authority: keeper.publicKey, config: configPda, commodity: gldPda })
        .signers([keeper])
        .rpc(),
      "Unauthorized",
    );
    await expectAnchorError(setParams({ maxDeviationBps: 10_001 }), "InvalidParams");
    await expectAnchorError(clearAnchor(keeper), "Unauthorized");
  });

  it("daily mint cap bounds minting within the window and is lifted by cap = 0", async () => {
    await pushPrice(GLD_PRICE);
    // Earlier tests already minted inside the current 24 h window: cap relative to that.
    let c = await program.account.commodity.fetch(gldPda);
    const minted0 = c.windowMinted.toNumber();
    const windowStart = c.windowStart.toNumber();
    expect(windowStart).to.be.greaterThan(0);
    await setParams({ dailyMintCap: new BN(minted0 + ONE) }); // +1 GLD for the rest of the window

    // ask $2,002 → $1,201.20 buys exactly 0.6 GLD
    await buy(1_201_200_000);
    c = await program.account.commodity.fetch(gldPda);
    expect(c.windowMinted.toNumber()).to.equal(minted0 + (6 * ONE) / 10);
    expect(c.windowStart.toNumber()).to.equal(windowStart);

    // 0.5 more would make 1.1 > cap
    await expectAnchorError(buy(1_001 * ONE), "DailyMintCapExceeded");
    // exactly to the cap is fine (0.4 GLD = $800.80)
    await buy(800_800_000);
    c = await program.account.commodity.fetch(gldPda);
    expect(c.windowMinted.toNumber()).to.equal(minted0 + ONE);
    // even 1 base unit over ($0.002002 → 1 base unit of GLD)
    await expectAnchorError(buy(2_002), "DailyMintCapExceeded");

    // cap 0 = unlimited; the counter keeps accumulating for observers
    await setParams({ dailyMintCap: new BN(0) });
    await buy(2_002 * ONE);
    c = await program.account.commodity.fetch(gldPda);
    expect(c.windowMinted.toNumber()).to.equal(minted0 + 2 * ONE);
  });

  it("daily redemption cap bounds USDC paid out by sell", async () => {
    await pushPrice(GLD_PRICE);
    let c = await program.account.commodity.fetch(gldPda);
    const redeemed0 = c.windowRedeemed.toNumber();
    await setParams({ dailyRedeemCap: new BN(redeemed0 + 500 * ONE) }); // +$500 for the rest of the window

    // bid $1,998 → 0.1 GLD pays $199.80
    await sell(ONE / 10);
    c = await program.account.commodity.fetch(gldPda);
    expect(c.windowRedeemed.toNumber()).to.equal(redeemed0 + 199_800_000);

    // +$399.60 would be $599.40 > $500
    await expectAnchorError(sell(ONE / 5), "DailyRedeemCapExceeded");
    // +$299.70 → $499.50 fits
    await sell((15 * ONE) / 100);
    c = await program.account.commodity.fetch(gldPda);
    expect(c.windowRedeemed.toNumber()).to.equal(redeemed0 + 499_500_000);
    // buys are not affected by the redeem cap
    await buy(2_002 * ONE);

    await setParams({ dailyRedeemCap: new BN(0) });
  });

  it("price-deviation breaker refuses a jump vs the last accepted price while the anchor is fresh", async () => {
    await pushPrice(GLD_PRICE);
    await buy(2_002 * ONE); // anchor = $2,000 now
    await setParams({ maxDeviationBps: 200, deviationWindowSecs: 600 });

    // keeper posts +4% (allowed by max_move_bps = 5%) — trades against it must fail both ways
    await pushPrice(Math.round(GLD_PRICE * 1.04));
    await expectAnchorError(buy(2_002 * ONE), "PriceDeviationTooLarge");
    await expectAnchorError(sell(ONE / 10), "PriceDeviationTooLarge");

    // admin clears the anchor → the next trade re-anchors at $2,080
    await clearAnchor(admin);
    await buy(2_082_080_000); // ask $2,082.08 → 1 GLD
    let c = await program.account.commodity.fetch(gldPda);
    expect(c.lastPrice.toNumber()).to.equal(Math.round(GLD_PRICE * 1.04));

    // −0.96% from the new anchor is inside 2%
    await pushPrice(Math.round(GLD_PRICE * 1.03));
    await buy(200 * ONE);
    c = await program.account.commodity.fetch(gldPda);
    expect(c.lastPrice.toNumber()).to.equal(Math.round(GLD_PRICE * 1.03));
  });

  it("price-deviation bound widens by max_deviation_bps per elapsed window and the anchor is fixed within a window", async () => {
    // anchor = $2,060 from the previous trade; 2% per 3 s window (3 s, not 1 s: the helper's chain-clock
    // waits and RPC round trips would otherwise let extra windows elapse and widen the bound mid-test)
    const W = 3;
    await setParams({ maxDeviationBps: 200, deviationWindowSecs: W });
    const c0 = await program.account.commodity.fetch(gldPda);
    const anchor0 = c0.anchorPrice.toNumber();
    const anchorTs0 = c0.anchorTs.toNumber();
    // ≥1 window (2% allowed): −5% must fail
    await waitForChainPast(anchorTs0 + W);
    await pushPrice(Math.round(anchor0 * 0.95));
    await expectAnchorError(buy(2_000 * ONE), "PriceDeviationTooLarge");
    // ≥2 windows (4% allowed): −2.9% passes and re-anchors
    await waitForChainPast(anchorTs0 + 2 * W);
    await pushPrice(Math.round(anchor0 * 0.971));
    await buy(2_000 * ONE);
    const c1 = await program.account.commodity.fetch(gldPda);
    expect(c1.lastPrice.toNumber()).to.equal(Math.round(anchor0 * 0.971));
    // the trade re-anchored (window elapsed) at the new price and time
    expect(c1.anchorPrice.toNumber()).to.equal(Math.round(anchor0 * 0.971));
    expect(c1.anchorTs.toNumber()).to.be.greaterThan(c0.anchorTs.toNumber());

    await setParams({ maxDeviationBps: 0, deviationWindowSecs: 0 });
  });

  it("net-flow caps: a sell releases mint capacity and buyback-exempt sells do not consume the redeem window", async () => {
    await pushPrice(GLD_PRICE);
    let c = await program.account.commodity.fetch(gldPda);
    const minted0 = c.windowMinted.toNumber();
    const redeemed0 = c.windowRedeemed.toNumber();
    await buy(2_002 * ONE); // +1 GLD minted
    await sell(ONE / 2); // −0.5 GLD → releases 0.5 of mint capacity, adds $999 redeemed
    c = await program.account.commodity.fetch(gldPda);
    expect(c.windowMinted.toNumber()).to.equal(minted0 + ONE / 2);
    // the $2,002 buy releases redeem capacity (saturating), then the sell adds $999
    expect(c.windowRedeemed.toNumber()).to.equal(Math.max(0, redeemed0 - 2_002 * ONE) + 999 * ONE);

    // exempt signer: its sells are allowed above the cap and do not accumulate (audit F-07)
    await program.methods
      .setRedeemCapExempt(user.publicKey)
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();
    await setParams({ dailyRedeemCap: new BN(1) });
    const before = (await program.account.commodity.fetch(gldPda)).windowRedeemed.toNumber();
    await sell(ONE / 10);
    expect((await program.account.commodity.fetch(gldPda)).windowRedeemed.toNumber()).to.equal(before);
    await program.methods
      .setRedeemCapExempt(PublicKey.default)
      .accountsPartial({ admin: admin.publicKey, config: configPda })
      .rpc();
    await setParams({ dailyRedeemCap: new BN(0) });
  });
});
