/**
 * `PegDeskClient` — builds (does not send) instructions for the `peg_desk` program per
 * docs/CONTRACTS.md §1. Uses `Program<any>` + the IDL emitted by `anchor build`
 * (`target/idl/peg_desk.json`), passed in by the caller (keeper/scripts read it from disk,
 * the web app fetches it from `/idl/peg_desk.json`). Swap `any` for `Program<PegDesk>` from
 * `target/types/peg_desk.ts` once that file is generated.
 *
 * Anchor 0.31's TS client camelCases IDL names, so every `.accountsPartial({...})` key below is
 * the camelCase of the Rust `#[derive(Accounts)]` field name in programs/peg_desk/src/instructions/*
 * and every args object key is the camelCase of the Rust struct field (e.g. `max_age_open` →
 * `maxAgeOpen`). Keep them in lock-step with the Rust structs.
 */
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { PROGRAM_IDS } from "@icemarkets/registry";
import { pegDesk as pegDeskPda, programDataPda, symbolToBytes12 } from "./pda";
import {
  Status,
  QuoteScale,
  scaleQuote,
  weightedSum,
  reserveRatioBps,
  quoteBuy,
  quoteSell,
  quoteBuyExactOut,
  type CommodityPricingParams,
  type SpreadInputs,
} from "./pricing";

export const PEG_DESK_PROGRAM_ID = new PublicKey(PROGRAM_IDS.pegDesk);
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(PROGRAM_IDS.tokenMetadata);

/** Placeholder for the Anchor-generated `PegDesk` IDL type until `anchor build` runs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PegDeskIdl = any;

/** On-chain `OracleKind` discriminants (state.rs). */
export const ORACLE_KIND = { PythPull: 0, Switchboard: 1, KeeperSigned: 2, Composite: 3 } as const;

/** On-chain `Commodity` fields (+ GlobalConfig risk params + mint supply) the SDK needs. Subset of CONTRACTS §1. */
export interface CommodityAccountView {
  symbol: string;
  coinMint: PublicKey;
  decimals: number;
  status: Status;
  oracleKind: number;
  /** 0 = USD, 1 = US cents, 2 = EUR (needs `fxFeedAccount`). */
  quoteScale: number;
  feedAccount: PublicKey;
  fxFeedAccount: PublicKey;
  reserveVault: PublicKey;
  reserveBalanceCached: bigint;
  supplyCap: bigint;
  perTxCap: bigint;
  baseSpreadBps: bigint;
  closedSpreadBps: bigint;
  confMultBps: bigint;
  maxAgeOpenSec: bigint;
  maxAgeClosedSec: bigint;
  /** GlobalConfig.reserve_warn_bps / reserve_halt_bps. */
  reserveWarnBps: bigint;
  reserveHaltBps: bigint;
  /** Outstanding coin supply (from the mint), for reserve-ratio math. */
  supply: bigint;
  /** Circuit breakers (state.rs). Caps are base units; 0 = disabled. */
  breakers: {
    dailyMintCap: bigint;
    dailyRedeemCap: bigint;
    windowStart: bigint;
    windowMinted: bigint;
    windowRedeemed: bigint;
    maxDeviationBps: number;
    deviationWindowSecs: number;
    /** Last trade's oracle price (1e8) and publish time. */
    lastPrice: bigint;
    lastPublishTime: bigint;
    /** Deviation anchor (1e8) and the validator time it was set; 0 = unanchored (audit F-06). */
    anchorPrice: bigint;
    anchorTs: bigint;
  };
  /** Composite only: the leg Commodity PDAs, in `legs` order. */
  legs?: PublicKey[];
  /** Composite only: per-leg data needed to price the index client-side and build remaining accounts. */
  legViews?: CompositeLegView[];
}

/** One leg of a Composite (index) commodity, read from the leg's own `Commodity` account. */
export interface CompositeLegView {
  commodity: PublicKey;
  symbol: string;
  weightBps: number;
  oracleKind: number;
  quoteScale: number;
  feedAccount: PublicKey;
  status: Status;
}

/** `[u8; 12]` NUL-padded symbol → string. */
function symbolFromBytes(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length && bytes[i] !== 0; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** A fresh oracle reading to price a trade against (Pyth PriceUpdateV2, KeeperPrice, or stand-in). */
export interface OracleReading {
  price: bigint; // USD at 1e8
  conf: bigint; // USD at 1e8
  publishTime: bigint; // unix seconds
}

type RemainingAccount = AccountMeta;

/**
 * Browser-friendly factory: a PegDeskClient that only BUILDS instructions (no signing), so the web app
 * does not need `@coral-xyz/anchor` / a wallet adapter wrapper of its own.
 */
export function createPegDeskClient(connection: Connection, walletPubkey: PublicKey, idl: PegDeskIdl, programId?: PublicKey): PegDeskClient {
  const wallet = {
    publicKey: walletPubkey,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PegDeskClient(new AnchorProvider(connection, wallet as any, { commitment: "confirmed" }), idl, programId);
}

/**
 * Minimal decoder for Pyth `PriceUpdateV2` (pyth-solana-receiver-sdk 0.6):
 * disc(8) | write_authority(32) | verification_level (enum: 0 Partial{num_signatures: u8} | 1 Full)
 * | price_message { feed_id[32], price i64, conf u64, exponent i32, publish_time i64, prev_publish_time i64,
 *   ema_price i64, ema_conf u64 } | posted_slot u64.
 * CHECK vs the receiver IDL before mainnet (used for client-side quotes only; the program re-reads on-chain).
 */
export function decodePriceUpdateV2(data: Buffer): { feedId: Buffer; price: bigint; conf: bigint; exponent: number; publishTime: bigint } {
  let o = 8 + 32;
  const level = data.readUInt8(o);
  o += level === 0 ? 2 : 1;
  const feedId = data.subarray(o, o + 32);
  o += 32;
  const price = data.readBigInt64LE(o);
  const conf = data.readBigUInt64LE(o + 8);
  const exponent = data.readInt32LE(o + 16);
  const publishTime = data.readBigInt64LE(o + 20);
  return { feedId: Buffer.from(feedId), price, conf, exponent, publishTime };
}

export class PegDeskClient {
  readonly program: Program<PegDeskIdl>;
  readonly programId: PublicKey;

  /**
   * @param idl  contents of `target/idl/peg_desk.json`. Its `address` is overridden with `programId`
   *             so the same IDL works on every cluster.
   */
  constructor(provider: AnchorProvider, idl: PegDeskIdl, programId: PublicKey = PEG_DESK_PROGRAM_ID) {
    this.programId = programId;
    this.program = new Program({ ...idl, address: programId.toBase58() }, provider) as Program<PegDeskIdl>;
  }

  // ---- PDAs ---------------------------------------------------------------
  configPda(): PublicKey {
    return pegDeskPda.config(this.programId)[0];
  }
  commodityPda(symbol: string): PublicKey {
    return pegDeskPda.commodity(this.programId, symbol)[0];
  }
  reservePda(commodity: PublicKey): PublicKey {
    return pegDeskPda.reserve(this.programId, commodity)[0];
  }
  keeperPricePda(commodity: PublicKey): PublicKey {
    return pegDeskPda.keeperPrice(this.programId, commodity)[0];
  }
  mintAuthPda(): PublicKey {
    return pegDeskPda.mintAuth(this.programId)[0];
  }

  // ---- account reads --------------------------------------------------------

  /** Reads Commodity + GlobalConfig + mint supply into a `CommodityAccountView`. */
  async fetchCommodityView(symbol: string): Promise<CommodityAccountView> {
    const pda = this.commodityPda(symbol);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = this.program.account as any;
    const [c, cfg] = await Promise.all([accounts.commodity.fetch(pda), accounts.globalConfig.fetch(this.configPda())]);
    const supply = await this.program.provider.connection.getTokenSupply(c.coinMint);
    const big = (x: { toString(): string } | number) => BigInt(x.toString());
    const legCount = Number(c.legCount);
    return {
      symbol,
      coinMint: c.coinMint,
      decimals: Number(c.decimals),
      status: Number(c.status) as Status,
      oracleKind: Number(c.oracleKind),
      quoteScale: Number(c.quoteScale),
      feedAccount: c.feedAccount,
      fxFeedAccount: c.fxFeedAccount,
      reserveVault: c.reserveVault,
      reserveBalanceCached: big(c.reserveBalanceCached),
      supplyCap: big(c.supplyCap),
      perTxCap: big(c.perTxCap),
      baseSpreadBps: big(c.baseSpreadBps),
      closedSpreadBps: big(c.closedSpreadBps),
      confMultBps: big(c.confMultBps),
      maxAgeOpenSec: big(c.maxAgeOpen),
      maxAgeClosedSec: big(c.maxAgeClosed),
      reserveWarnBps: big(cfg.reserveWarnBps),
      reserveHaltBps: big(cfg.reserveHaltBps),
      supply: BigInt(supply.value.amount),
      breakers: {
        dailyMintCap: big(c.dailyMintCap ?? 0),
        dailyRedeemCap: big(c.dailyRedeemCap ?? 0),
        windowStart: big(c.windowStart ?? 0),
        windowMinted: big(c.windowMinted ?? 0),
        windowRedeemed: big(c.windowRedeemed ?? 0),
        maxDeviationBps: Number(c.maxDeviationBps ?? 0),
        deviationWindowSecs: Number(c.deviationWindowSecs ?? 0),
        lastPrice: big(c.lastPrice ?? 0),
        lastPublishTime: big(c.lastPublishTime ?? 0),
        anchorPrice: big(c.anchorPrice ?? 0),
        anchorTs: big(c.anchorTs ?? 0),
      },
      legs: legCount > 0 ? (c.legs as { commodity: PublicKey }[]).slice(0, legCount).map((l) => l.commodity) : undefined,
      legViews: legCount > 0 ? await this.fetchLegViews((c.legs as { commodity: PublicKey; weightBps: number }[]).slice(0, legCount)) : undefined,
    };
  }

  /** Reads each leg's `Commodity` account (Composite coins; oracle.rs `read_composite`). */
  private async fetchLegViews(legs: { commodity: PublicKey; weightBps: number }[]): Promise<CompositeLegView[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = this.program.account as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raws: any[] = await accounts.commodity.fetchMultiple(legs.map((l) => l.commodity));
    return legs.map((leg, i) => {
      const r = raws[i];
      if (!r) throw new Error(`fetchCommodityView: index leg ${leg.commodity.toBase58()} not found`);
      return {
        commodity: leg.commodity,
        symbol: symbolFromBytes(r.symbol as number[]),
        weightBps: Number(leg.weightBps),
        oracleKind: Number(r.oracleKind),
        quoteScale: Number(r.quoteScale),
        feedAccount: r.feedAccount as PublicKey,
        status: Number(r.status) as Status,
      };
    });
  }

  /** Reads the `KeeperPrice` PDA (KeeperSigned) as an `OracleReading`. */
  async fetchKeeperPrice(commodity: PublicKey): Promise<OracleReading> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kp = await (this.program.account as any).keeperPrice.fetch(this.keeperPricePda(commodity));
    return { price: BigInt(kp.price.toString()), conf: BigInt(kp.conf.toString()), publishTime: BigInt(kp.publishTime.toString()) };
  }

  /**
   * The oracle reading the program would use for `commodity` (oracle.rs `read_price`), for client-side
   * quotes: PythPull → decoded PriceUpdateV2 at feed_account (scaled like `scale_quote`; EUR unsupported
   * here), KeeperSigned → KeeperPrice PDA, Switchboard stand-in → KeeperPrice-shaped feed_account.
   * Composite (index coins): weighted sum of the legs' readings (see `fetchCompositeReading`).
   */
  async fetchOracleReading(commodity: CommodityAccountView): Promise<OracleReading> {
    if (commodity.oracleKind === ORACLE_KIND.Composite) return this.fetchCompositeReading(commodity);
    return this.readSingleOracle(this.commodityPda(commodity.symbol), commodity.oracleKind, commodity.quoteScale, commodity.feedAccount);
  }

  /** PythPull / KeeperSigned / Switchboard-stand-in reading for one (non-Composite) commodity. */
  private async readSingleOracle(pda: PublicKey, oracleKind: number, quoteScale: number, feedAccount: PublicKey): Promise<OracleReading> {
    const conn = this.program.provider.connection;
    switch (oracleKind) {
      case ORACLE_KIND.KeeperSigned:
        return this.fetchKeeperPrice(pda);
      case ORACLE_KIND.Switchboard: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kp = await (this.program.account as any).keeperPrice.fetch(feedAccount);
        return { price: BigInt(kp.price.toString()), conf: BigInt(kp.conf.toString()), publishTime: BigInt(kp.publishTime.toString()) };
      }
      case ORACLE_KIND.PythPull: {
        if (quoteScale === QuoteScale.Eur) throw new Error("fetchOracleReading: EUR-quoted feeds not supported client-side");
        const info = await conn.getAccountInfo(feedAccount);
        if (!info) throw new Error(`fetchOracleReading: feed account ${feedAccount.toBase58()} not found`);
        const u = decodePriceUpdateV2(info.data);
        if (u.price <= 0n) throw new Error("fetchOracleReading: non-positive Pyth price");
        return {
          price: scaleQuote(u.price, u.exponent, quoteScale),
          conf: scaleQuote(u.conf, u.exponent, quoteScale),
          publishTime: u.publishTime,
        };
      }
      default:
        throw new Error(`fetchOracleReading: oracle kind ${oracleKind} not supported client-side`);
    }
  }

  /**
   * Composite (index) reading, mirroring oracle.rs `read_composite`: price = Σ leg price × weight / 10_000,
   * conf = the same weighted sum of leg confs (both rounded down), publish_time = the OLDEST leg's. Legs
   * may not be Composite/EUR or Halted (the program rejects those with InvalidLegs / MarketHalted).
   */
  private async fetchCompositeReading(commodity: CommodityAccountView): Promise<OracleReading> {
    const legs = commodity.legViews;
    if (!legs || legs.length === 0) throw new Error(`fetchOracleReading: ${commodity.symbol} is Composite but has no legs`);
    const readings = await Promise.all(
      legs.map((l) => {
        if (l.oracleKind === ORACLE_KIND.Composite) throw new Error(`index leg ${l.symbol} is itself Composite`);
        if (l.status === Status.Halted) throw new Error(`index leg ${l.symbol} is Halted`);
        return this.readSingleOracle(l.commodity, l.oracleKind, l.quoteScale, l.feedAccount);
      }),
    );
    let minPt = readings[0].publishTime;
    for (const r of readings) if (r.publishTime < minPt) minPt = r.publishTime;
    return {
      price: weightedSum(readings.map((r, i): [bigint, number] => [r.price, legs[i].weightBps])),
      conf: weightedSum(readings.map((r, i): [bigint, number] => [r.conf, legs[i].weightBps])),
      publishTime: minPt,
    };
  }

  // ---- client-side pricing (mirrors pricing.rs, see pricing.ts) -----------

  private spreadInputs(commodity: CommodityAccountView, oracle: OracleReading, nowSec: number): SpreadInputs {
    // state.rs `max_age`: Open uses max_age_open, everything else (Closed/Halted) max_age_closed.
    const maxAge = commodity.status === Status.Open ? commodity.maxAgeOpenSec : commodity.maxAgeClosedSec;
    const params: CommodityPricingParams = {
      baseSpreadBps: commodity.baseSpreadBps,
      closedSpreadBps: commodity.closedSpreadBps,
      confMultBps: commodity.confMultBps,
      coinDecimals: commodity.decimals,
      usdcDecimals: 6,
      reserveWarnBps: commodity.reserveWarnBps,
      reserveHaltBps: commodity.reserveHaltBps,
    };
    return {
      status: commodity.status,
      conf: oracle.conf,
      price: oracle.price,
      ageSec: BigInt(Math.max(0, nowSec - Number(oracle.publishTime))),
      maxAgeSec: maxAge,
      params,
      // trade.rs uses the PRE-trade ratio (reserve_vault.amount, mint.supply) for the ×2 widening.
      reserveRatioBps: reserveRatioBps(commodity.reserveBalanceCached, commodity.supply, oracle.price, commodity.decimals, 6),
    };
  }

  /** Client-side buy quote (usdc_in -> coin_out), mirroring the on-chain `buy` pricing exactly. */
  quote(commodity: CommodityAccountView, oracle: OracleReading, usdcIn: bigint, nowSec: number = Math.floor(Date.now() / 1000)) {
    return quoteBuy(usdcIn, this.spreadInputs(commodity, oracle, nowSec));
  }

  /** Client-side sell quote (coin_in -> usdc_out). */
  quoteSell(commodity: CommodityAccountView, oracle: OracleReading, coinIn: bigint, nowSec: number = Math.floor(Date.now() / 1000)) {
    return quoteSell(coinIn, this.spreadInputs(commodity, oracle, nowSec));
  }

  /** Client-side exact-out buy quote (coin_out -> max_usdc_in), used by the launch builder. */
  quoteBuyExactOut(commodity: CommodityAccountView, oracle: OracleReading, coinOut: bigint, nowSec: number = Math.floor(Date.now() / 1000)) {
    return quoteBuyExactOut(coinOut, this.spreadInputs(commodity, oracle, nowSec));
  }

  // ---- instruction builders (trading) --------------------------------------

  /**
   * The optional oracle accounts of `TradeAccounts` (trade.rs), chosen by oracle kind:
   *  - PythPull:    priceFeed = commodity.feed_account (+ fxFeed when quote_scale == EUR)
   *  - Switchboard: priceFeed = commodity.feed_account (KeeperPrice-shaped stand-in)
   *  - KeeperSigned: keeperPrice = PDA["kp", commodity]
   *  - Composite:   none here; pass `[leg Commodity, leg price source] × n` as remaining accounts
   *                 (see `compositeRemainingAccounts`).
   * Unused optional accounts are passed as `null` (Anchor encodes None as the program id).
   */
  oracleAccounts(commodity: CommodityAccountView): { priceFeed: PublicKey | null; fxFeed: PublicKey | null; keeperPrice: PublicKey | null } {
    const pda = this.commodityPda(commodity.symbol);
    switch (commodity.oracleKind) {
      case ORACLE_KIND.PythPull:
        return {
          priceFeed: commodity.feedAccount,
          fxFeed: commodity.quoteScale === QuoteScale.Eur ? commodity.fxFeedAccount : null,
          keeperPrice: null,
        };
      case ORACLE_KIND.Switchboard:
        return { priceFeed: commodity.feedAccount, fxFeed: null, keeperPrice: null };
      case ORACLE_KIND.KeeperSigned:
        return { priceFeed: null, fxFeed: null, keeperPrice: this.keeperPricePda(pda) };
      default:
        return { priceFeed: null, fxFeed: null, keeperPrice: null };
    }
  }

  /**
   * Default remaining accounts for a trade on `commodity`: the Composite leg pairs when it is an index
   * coin (from `legViews`), otherwise none. Used by buy / buy_exact_out / sell when the caller passes none.
   */
  tradeRemainingAccounts(commodity: CommodityAccountView): RemainingAccount[] {
    if (commodity.oracleKind !== ORACLE_KIND.Composite || !commodity.legViews) return [];
    const out: RemainingAccount[] = [];
    for (const leg of commodity.legViews) {
      const src = leg.oracleKind === ORACLE_KIND.KeeperSigned ? this.keeperPricePda(leg.commodity) : leg.feedAccount;
      out.push({ pubkey: leg.commodity, isSigner: false, isWritable: false }, { pubkey: src, isSigner: false, isWritable: false });
    }
    return out;
  }

  /** remaining_accounts for a Composite trade: `[leg Commodity, leg price source]` per leg (oracle.rs `read_composite`). */
  compositeRemainingAccounts(legs: CommodityAccountView[]): RemainingAccount[] {
    const out: RemainingAccount[] = [];
    for (const leg of legs) {
      const legPda = this.commodityPda(leg.symbol);
      const src =
        leg.oracleKind === ORACLE_KIND.KeeperSigned ? this.keeperPricePda(legPda) : leg.feedAccount;
      out.push({ pubkey: legPda, isSigner: false, isWritable: false }, { pubkey: src, isSigner: false, isWritable: false });
    }
    return out;
  }

  /** `TradeAccounts` (trade.rs) — shared by buy / buy_exact_out / sell. */
  private tradeAccounts(user: PublicKey, commodity: CommodityAccountView, userUsdcAta: PublicKey) {
    return {
      user,
      config: this.configPda(),
      commodity: this.commodityPda(commodity.symbol),
      coinMint: commodity.coinMint,
      mintAuth: this.mintAuthPda(),
      reserveVault: commodity.reserveVault,
      userUsdc: userUsdcAta,
      userCoin: getAssociatedTokenAddressSync(commodity.coinMint, user, true),
      ...this.oracleAccounts(commodity),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  /**
   * `user_coin` must already exist (TradeAccounts does not init it). Prepend this to any buy /
   * buy_exact_out transaction; it is a no-op if the ATA exists.
   */
  createUserCoinAtaIx(payer: PublicKey, user: PublicKey, coinMint: PublicKey): TransactionInstruction {
    return createAssociatedTokenAccountIdempotentInstruction(payer, getAssociatedTokenAddressSync(coinMint, user, true), user, coinMint);
  }

  /** `buy(usdc_in, min_coin_out)`. */
  async buyIx(params: {
    user: PublicKey;
    commodity: CommodityAccountView;
    usdcIn: bigint;
    minCoinOut: bigint;
    userUsdcAta: PublicKey;
    remainingAccounts?: RemainingAccount[];
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .buy(new BN(params.usdcIn.toString()), new BN(params.minCoinOut.toString()))
      .accountsPartial(this.tradeAccounts(params.user, params.commodity, params.userUsdcAta))
      .remainingAccounts(params.remainingAccounts ?? this.tradeRemainingAccounts(params.commodity))
      .instruction();
  }

  /** `buy_exact_out(coin_out, max_usdc_in)` — used by the launch builder for the pre-DBC COIN acquisition leg. */
  async buyExactOutIx(params: {
    user: PublicKey;
    commodity: CommodityAccountView;
    coinOut: bigint;
    maxUsdcIn: bigint;
    userUsdcAta: PublicKey;
    remainingAccounts?: RemainingAccount[];
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .buyExactOut(new BN(params.coinOut.toString()), new BN(params.maxUsdcIn.toString()))
      .accountsPartial(this.tradeAccounts(params.user, params.commodity, params.userUsdcAta))
      .remainingAccounts(params.remainingAccounts ?? this.tradeRemainingAccounts(params.commodity))
      .instruction();
  }

  /**
   * `sell(coin_in, min_usdc_out)` — allowed in Open and Closed. No treasury account: the spread stays
   * in the reserve until `sweep_spread_fees` (CONTRACTS §6).
   */
  async sellIx(params: {
    user: PublicKey;
    commodity: CommodityAccountView;
    coinIn: bigint;
    minUsdcOut: bigint;
    userUsdcAta: PublicKey;
    remainingAccounts?: RemainingAccount[];
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .sell(new BN(params.coinIn.toString()), new BN(params.minUsdcOut.toString()))
      .accountsPartial(this.tradeAccounts(params.user, params.commodity, params.userUsdcAta))
      .remainingAccounts(params.remainingAccounts ?? this.tradeRemainingAccounts(params.commodity))
      .instruction();
  }

  /** `deposit_reserve(amount)` — permissionless USDC top-up of a commodity's reserve vault. */
  async depositReserveIx(params: {
    from: PublicKey;
    fromUsdcAta: PublicKey;
    commodity: CommodityAccountView;
    amount: bigint;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .depositReserve(new BN(params.amount.toString()))
      .accountsPartial({
        depositor: params.from,
        commodity: this.commodityPda(params.commodity.symbol),
        reserveVault: params.commodity.reserveVault,
        from: params.fromUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /** `sweep_spread_fees(amount)` — keeper/admin; only while the post-sweep ratio stays ≥ reserve_warn_bps. */
  async sweepSpreadFeesIx(params: {
    authority: PublicKey;
    commodity: CommodityAccountView;
    treasuryUsdcAta: PublicKey;
    amount: bigint;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .sweepSpreadFees(new BN(params.amount.toString()))
      .accountsPartial({
        authority: params.authority,
        config: this.configPda(),
        commodity: this.commodityPda(params.commodity.symbol),
        coinMint: params.commodity.coinMint,
        reserveVault: params.commodity.reserveVault,
        treasuryUsdc: params.treasuryUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  // ---- instruction builders (admin/keeper) --------------------------------

  /** `initialize_config(max_conf_bps, reserve_warn_bps, reserve_halt_bps)` — payer (must be the upgrade authority) becomes admin. */
  async initializeConfigIx(params: {
    payer: PublicKey;
    reserveMint: PublicKey;
    treasury: PublicKey;
    maxConfBps: number;
    reserveWarnBps: number;
    reserveHaltBps: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .initializeConfig(params.maxConfBps, params.reserveWarnBps, params.reserveHaltBps)
      .accountsPartial({
        payer: params.payer,
        program: this.program.programId,
        programData: programDataPda(this.program.programId),
        config: this.configPda(),
        reserveMint: params.reserveMint,
        treasury: params.treasury,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** `set_keepers(keepers)` — admin, ≤ 8. */
  async setKeepersIx(params: { admin: PublicKey; keepers: PublicKey[] }): Promise<TransactionInstruction> {
    return this.program.methods
      .setKeepers(params.keepers)
      .accountsPartial({ admin: params.admin, config: this.configPda() })
      .instruction();
  }

  /**
   * `create_commodity(CreateCommodityArgs)` — admin-only. `coinMint` is a fresh Keypair that must also
   * sign. Field names mirror `CreateCommodityArgs` in instructions/commodity.rs (camelCased).
   */
  async createCommodityIx(params: {
    admin: PublicKey;
    payer: PublicKey;
    coinMint: PublicKey;
    reserveMint: PublicKey;
    symbol: string;
    oracleKind: number;
    sessionKind: number;
    feedId: Buffer; // 32 bytes
    /** PythPull: PriceUpdateV2 account; Switchboard (stand-in): KeeperPrice PDA; else PublicKey.default. */
    feedAccount: PublicKey;
    fxFeedId: Buffer; // 32 bytes, zero-filled if unused
    fxFeedAccount: PublicKey;
    quoteScale: number;
    /** 0 = require fully-verified Pyth updates. */
    pythMinSignatures: number;
    name: string;
    uri: string;
    params: {
      baseSpreadBps: number;
      closedSpreadBps: number;
      confMultBps: number;
      maxAgeOpenSec: number;
      maxAgeClosedSec: number;
      /** coin base units */
      supplyCap: bigint;
      /** coin base units */
      perTxCap: bigint;
    };
    /** Metaplex metadata PDA for coinMint (derived if omitted). */
    metadataAccount?: PublicKey;
    tokenMetadataProgram?: PublicKey;
  }): Promise<TransactionInstruction> {
    const tokenMetadataProgram = params.tokenMetadataProgram ?? TOKEN_METADATA_PROGRAM_ID;
    const commodityPda = this.commodityPda(params.symbol);
    const metadata =
      params.metadataAccount ??
      PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), tokenMetadataProgram.toBuffer(), params.coinMint.toBuffer()],
        tokenMetadataProgram,
      )[0];
    return this.program.methods
      .createCommodity({
        symbol: Array.from(symbolToBytes12(params.symbol)),
        oracleKind: params.oracleKind,
        sessionKind: params.sessionKind,
        feedId: Array.from(params.feedId),
        feedAccount: params.feedAccount,
        fxFeedId: Array.from(params.fxFeedId),
        fxFeedAccount: params.fxFeedAccount,
        quoteScale: params.quoteScale,
        baseSpreadBps: params.params.baseSpreadBps,
        closedSpreadBps: params.params.closedSpreadBps,
        confMultBps: params.params.confMultBps,
        maxAgeOpen: params.params.maxAgeOpenSec,
        maxAgeClosed: params.params.maxAgeClosedSec,
        supplyCap: new BN(params.params.supplyCap.toString()),
        perTxCap: new BN(params.params.perTxCap.toString()),
        pythMinSignatures: params.pythMinSignatures,
        name: params.name,
        uri: params.uri,
      })
      .accountsPartial({
        payer: params.payer,
        admin: params.admin,
        config: this.configPda(),
        mintAuth: this.mintAuthPda(),
        reserveMint: params.reserveMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMetadataProgram,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        commodity: commodityPda,
        coinMint: params.coinMint,
        reserveVault: this.reservePda(commodityPda),
        metadata,
      })
      .instruction();
  }

  /**
   * `set_commodity_params(SetParamsArgs)` — admin. Every field is optional; omitted fields are left
   * unchanged on-chain. Circuit breakers: `dailyMintCap` (coin base units), `dailyRedeemCap`
   * (USDC base units), `maxDeviationBps`, `deviationWindowSecs` — 0 disables each one.
   */
  async setCommodityParamsIx(params: {
    admin: PublicKey;
    symbol: string;
    sessionKind?: number;
    feedId?: Buffer;
    fxFeedId?: Buffer;
    quoteScale?: number;
    baseSpreadBps?: number;
    closedSpreadBps?: number;
    confMultBps?: number;
    maxAgeOpenSec?: number;
    maxAgeClosedSec?: number;
    supplyCap?: bigint;
    perTxCap?: bigint;
    pythMinSignatures?: number;
    dailyMintCap?: bigint;
    dailyRedeemCap?: bigint;
    maxDeviationBps?: number;
    deviationWindowSecs?: number;
  }): Promise<TransactionInstruction> {
    const opt = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
    const optBn = (v: bigint | undefined) => (v === undefined ? null : new BN(v.toString()));
    return this.program.methods
      .setCommodityParams({
        sessionKind: opt(params.sessionKind),
        feedId: params.feedId ? Array.from(params.feedId) : null,
        fxFeedId: params.fxFeedId ? Array.from(params.fxFeedId) : null,
        quoteScale: opt(params.quoteScale),
        baseSpreadBps: opt(params.baseSpreadBps),
        closedSpreadBps: opt(params.closedSpreadBps),
        confMultBps: opt(params.confMultBps),
        maxAgeOpen: opt(params.maxAgeOpenSec),
        maxAgeClosed: opt(params.maxAgeClosedSec),
        supplyCap: optBn(params.supplyCap),
        perTxCap: optBn(params.perTxCap),
        pythMinSignatures: opt(params.pythMinSignatures),
        dailyMintCap: optBn(params.dailyMintCap),
        dailyRedeemCap: optBn(params.dailyRedeemCap),
        maxDeviationBps: opt(params.maxDeviationBps),
        deviationWindowSecs: opt(params.deviationWindowSecs),
      })
      .accountsPartial({
        authority: params.admin,
        config: this.configPda(),
        commodity: this.commodityPda(params.symbol),
      })
      .instruction();
  }

  /** `clear_price_anchor()` — admin; resets the deviation breaker anchor after a legitimate gap. */
  async clearPriceAnchorIx(params: { admin: PublicKey; symbol: string }): Promise<TransactionInstruction> {
    return this.program.methods
      .clearPriceAnchor()
      .accountsPartial({
        authority: params.admin,
        config: this.configPda(),
        commodity: this.commodityPda(params.symbol),
      })
      .instruction();
  }

  /** `set_status(status)` — admin or keeper (keeper: Open<->Closed and ->Halted; admin-only Halted->Open). */
  async setStatusIx(params: { authority: PublicKey; symbol: string; status: Status }): Promise<TransactionInstruction> {
    return this.program.methods
      .setStatus(params.status)
      .accountsPartial({
        authority: params.authority,
        config: this.configPda(),
        commodity: this.commodityPda(params.symbol),
      })
      .instruction();
  }

  /**
   * `keeper_update_price(price, conf, publish_time, source_hash)` — keeper; KeeperSigned (and the
   * Switchboard stand-in). Bounded by KeeperPrice.max_move_bps / min_interval; creates the PDA on first use.
   */
  async keeperUpdatePriceIx(params: {
    keeper: PublicKey;
    symbol: string;
    commodity?: PublicKey;
    price: bigint;
    conf: bigint;
    publishTime: bigint;
    sourceHash: Buffer; // 32 bytes
  }): Promise<TransactionInstruction> {
    const commodity = params.commodity ?? this.commodityPda(params.symbol);
    return this.program.methods
      .keeperUpdatePrice(
        new BN(params.price.toString()),
        new BN(params.conf.toString()),
        new BN(params.publishTime.toString()),
        Array.from(params.sourceHash),
      )
      .accountsPartial({
        keeper: params.keeper,
        config: this.configPda(),
        commodity,
        keeperPrice: this.keeperPricePda(commodity),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** `set_feed_account(feed_account, fx_feed_account)` — admin or keeper; rotates the posted Pyth update account. */
  async setFeedAccountIx(params: {
    authority: PublicKey;
    symbol: string;
    feedAccount: PublicKey;
    fxFeedAccount: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .setFeedAccount(params.feedAccount, params.fxFeedAccount)
      .accountsPartial({
        authority: params.authority,
        config: this.configPda(),
        commodity: this.commodityPda(params.symbol),
      })
      .instruction();
  }

  /** `set_index_legs(legs)` — admin, Composite only; remaining = leg Commodity PDAs in order. */
  async setIndexLegsIx(params: { authority: PublicKey; symbol: string; legs: { symbol: string; weightBps: number }[] }): Promise<TransactionInstruction> {
    // Rust field `_pad`: Anchor's camelCase conversion strips the leading underscore ("pad"); both keys
    // are supplied so encoding works either way (the Borsh coder ignores unknown keys).
    const legs = params.legs.map((l) => ({
      commodity: this.commodityPda(l.symbol),
      weightBps: l.weightBps,
      pad: Array(6).fill(0),
      _pad: Array(6).fill(0),
    }));
    return this.program.methods
      .setIndexLegs(legs)
      .accountsPartial({
        authority: params.authority,
        config: this.configPda(),
        commodity: this.commodityPda(params.symbol),
      })
      .remainingAccounts(legs.map((l) => ({ pubkey: l.commodity, isSigner: false, isWritable: false })))
      .instruction();
  }
}
