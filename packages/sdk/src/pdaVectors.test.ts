/**
 * Pins every PDA / ATA derivation in pda.ts to fixed addresses computed independently with
 * @solana/web3.js + @solana/spl-token, and differential-tests `ata()` against spl-token on random
 * keys. Complements pda.test.ts (devnet-confirmed fixtures for the launch path): this file covers
 * the whole surface — every fee_router vault, the distributor epoch index encoding, buyback PDAs.
 * If a seed or program id changes on purpose, regenerate the vectors rather than editing by hand.
 */
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PROGRAM_IDS } from "@icemarkets/registry";
import { ASSOCIATED_TOKEN_PROGRAM, TOKEN_PROGRAM, ata, buyback, distributor, feeRouter, pegDesk, symbolToBytes12 } from "./pda";

const IDS = {
  pegDesk: new PublicKey("6jMv6pdi3nB4RRmJSojDy2cHRLMgKNM3ZEeJFngWrqQN"),
  feeRouter: new PublicKey("9bnCKVesMxQPDaWAmiT21vaES2QgtdXinfXciTCZrbEt"),
  distributor: new PublicKey("AEGw9dc3MUYR3aJXzZJjQmQDsJBJuT1RfsjoByNv4dV6"),
  buyback: new PublicKey("2jsn1m1EnUx2AixWn8KSvWa7bqgQJrLqr2pQenzok4Lk"),
};
// Arbitrary but fixed inputs the vectors were generated with.
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const OWNER = new PublicKey("11111111111111111111111111111112");

// Generated with @solana/web3.js findProgramAddressSync / spl-token getAssociatedTokenAddressSync.
const V = {
  config: "9E4VJpHEjkUgoNCMkwLDt5jzUVgD7jsvjU4myP6KdjRJ",
  configBump: 254,
  commodityGLD: "8hwRobKmsbS7wDp6AEm29AtfHQVgXxP1cxpMeiRksJUs",
  commodityBump: 255,
  reserve: "7GUkioT3dTDt5181eCzqoGtL8pThHy5Eq7d35Ba5NWCN",
  keeperPrice: "8jQ4JQvtLBP5iEkgzK4zu2YUkdXJ8hWsGkK1y67yQTEP",
  mintAuth: "6aAzMSfhvSC7DTprFdTmRv1TgVKMBy2dhWxSNiXY15PC",
  router: "DgUPQKheM3SHj6jL83HqY7qqrjLAfeevWNBzZzaeACM5",
  pool: "4enu39qAsyJ7onT2Gik2DTKttGctWUKC3v9Ee8mhkkVq",
  holderVault: "2D5ef8vUFhHcCifAS22tugfVZf1feLWdv2Ce2XeN5gBA",
  buybackVault: "4zwTKegNebhDS9HanxX4GMJjExAJLMX74fNbdAG7zJZj",
  treasury: "A6k5FKyvQwMarkeAVFHuonFq5pxsktGYz88cYPtV59oF",
  distConfig: "3qECcwdijb3TLGZKFXmcuSjHiBwedV6uPgSHXSZuVcVR",
  distAuth: "8xU3FbogHzMGAMwttQQ5QnSFk6HTeY3oB3rMcByGBmmz",
  epoch7: "A89vzPBXktnDhnx8bjsFLB5QqHp6AdfXdxNL3h8f8Dvx",
  claimed: "Hc4gpKeDMKZmeMJSGje6Ns7T5rfLazjsM4G7JPGKBtJB",
  bbState: "HzQJiWr57mu7Wm11WGns6Fvze7ynr6rKapqDkFYUhM9X",
  bbAuth: "DC8Jjh1YtmzMG8BfTZDcGHubuMn5RrJiYt68JUJt24aZ",
  ataUsdcOwner: "4tRapEGgJZKuGoeeMRrpHsxAEuvo5YnDCzTXykqDhrK9",
  ataUsdcRouter: "JCnfBNKEDDT4QGkdYMHQr7U9LF9BPbp6rkBDWGCpkBGa",
  ataEpoch: "5cGMKwNQCadXmvMVWreM72G4LnoVqWH5N5z7NejNRVxj",
};

const eq = (got: PublicKey, want: string, label: string) => expect(got.toBase58(), label).to.equal(want);

describe("pda: program constants", () => {
  it("token / associated-token program ids match spl-token's", () => {
    eq(TOKEN_PROGRAM, TOKEN_PROGRAM_ID.toBase58(), "TOKEN_PROGRAM");
    eq(ASSOCIATED_TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), "ASSOCIATED_TOKEN_PROGRAM");
  });

  it("registry program ids are the ones the vectors were generated for", () => {
    // If these change on purpose (redeploy), regenerate every vector in this file.
    expect(PROGRAM_IDS.pegDesk).to.equal(IDS.pegDesk.toBase58());
    expect(PROGRAM_IDS.feeRouter).to.equal(IDS.feeRouter.toBase58());
    expect(PROGRAM_IDS.distributor).to.equal(IDS.distributor.toBase58());
    expect(PROGRAM_IDS.buyback).to.equal(IDS.buyback.toBase58());
  });
});

describe("pda: symbolToBytes12", () => {
  it("NUL-pads on the right and rejects bad symbols", () => {
    expect(Array.from(symbolToBytes12("GLD"))).to.deep.equal([71, 76, 68, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(symbolToBytes12("DEAGLBLAZE12").length).to.equal(12);
    for (const bad of ["", "gld", "GLD-1", "TOOLONGSYMBOL", "É"]) {
      expect(() => symbolToBytes12(bad), bad).to.throw();
    }
  });
});

describe("pda: peg_desk", () => {
  it("config / commodity / reserve / keeperPrice / mintAuth", () => {
    const [config, configBump] = pegDesk.config(IDS.pegDesk);
    eq(config, V.config, "config");
    expect(configBump).to.equal(V.configBump);
    const [commodity, cb] = pegDesk.commodity(IDS.pegDesk, "GLD");
    eq(commodity, V.commodityGLD, "commodity GLD");
    expect(cb).to.equal(V.commodityBump);
    eq(pegDesk.reserve(IDS.pegDesk, commodity)[0], V.reserve, "reserve");
    eq(pegDesk.keeperPrice(IDS.pegDesk, commodity)[0], V.keeperPrice, "keeperPrice");
    eq(pegDesk.mintAuth(IDS.pegDesk)[0], V.mintAuth, "mintAuth");
  });

  it("commodity PDA depends on the padded symbol, not a prefix", () => {
    expect(pegDesk.commodity(IDS.pegDesk, "GLD")[0].equals(pegDesk.commodity(IDS.pegDesk, "GLDX")[0])).to.equal(false);
  });
});

describe("pda: fee_router", () => {
  it("router / pool / holderVault / buybackVault / treasury / routerQuoteRecv", () => {
    eq(feeRouter.router(IDS.feeRouter)[0], V.router, "router");
    eq(feeRouter.pool(IDS.feeRouter, USDC)[0], V.pool, "pool");
    eq(feeRouter.holderVault(IDS.feeRouter, USDC)[0], V.holderVault, "holderVault");
    eq(feeRouter.buybackVault(IDS.feeRouter, USDC)[0], V.buybackVault, "buybackVault");
    eq(feeRouter.treasury(IDS.feeRouter, USDC)[0], V.treasury, "treasury");
    eq(feeRouter.routerQuoteRecv(IDS.feeRouter, USDC), V.ataUsdcRouter, "routerQuoteRecv (ATA of router PDA)");
  });
});

describe("pda: distributor", () => {
  it("config / distAuth / epoch / epochVault / claimed", () => {
    eq(distributor.config(IDS.distributor)[0], V.distConfig, "distConfig");
    eq(distributor.distAuth(IDS.distributor)[0], V.distAuth, "distAuth");
    const [epoch] = distributor.epoch(IDS.distributor, USDC, 7);
    eq(epoch, V.epoch7, "epoch 7");
    eq(distributor.epochVault(epoch, USDC), V.ataEpoch, "epochVault (ATA of epoch PDA)");
    eq(distributor.claimed(IDS.distributor, epoch, OWNER)[0], V.claimed, "claimed");
  });

  it("epoch index is u32 little-endian", () => {
    // index 7 vs 7 << 8 must differ; index must not be truncated to a byte
    expect(distributor.epoch(IDS.distributor, USDC, 7)[0].equals(distributor.epoch(IDS.distributor, USDC, 7 << 8)[0])).to.equal(false);
    expect(distributor.epoch(IDS.distributor, USDC, 256)[0].equals(distributor.epoch(IDS.distributor, USDC, 0)[0])).to.equal(false);
  });
});

describe("pda: buyback", () => {
  it("state / authority", () => {
    eq(buyback.state(IDS.buyback)[0], V.bbState, "bbState");
    eq(buyback.authority(IDS.buyback)[0], V.bbAuth, "bbAuth");
  });
});

describe("pda: ata()", () => {
  it("matches the pinned vectors", () => {
    eq(ata(USDC, OWNER), V.ataUsdcOwner, "ata(USDC, owner)");
    eq(ata(USDC, new PublicKey(V.router)), V.ataUsdcRouter, "ata(USDC, router PDA)");
  });

  it("matches spl-token getAssociatedTokenAddressSync for random mints/owners (both token programs)", () => {
    const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    for (let i = 0; i < 64; i++) {
      const mint = Keypair.generate().publicKey;
      const owner = Keypair.generate().publicKey;
      eq(ata(mint, owner), getAssociatedTokenAddressSync(mint, owner, true).toBase58(), `ata #${i}`);
      eq(
        ata(mint, owner, TOKEN_2022),
        getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022).toBase58(),
        `ata token-2022 #${i}`,
      );
    }
  });
});
