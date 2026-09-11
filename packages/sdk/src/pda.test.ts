/**
 * Address-derivation regression tests. Every fixture below was confirmed independently on devnet on
 * 2026-09-12 (spl-token CLI, `solana confirm -v` of the first launch tx 5Ye5tS73…CPon, on-chain PDAs), so
 * a wrong seed, seed order, or program-id constant fails here instead of as an AccountNotInitialized on
 * chain — the mistyped Associated Token Program id shipped for weeks because nothing did this.
 */
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveDbcPoolAddress as meteoraDeriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PROGRAM_IDS, USDC } from "@icemarkets/registry";
import { ASSOCIATED_TOKEN_PROGRAM, TOKEN_PROGRAM, ata, pegDesk, feeRouter, distributor, buyback } from "./pda";
import { deriveDbcPoolAddress } from "./dbc";

const pk = (s: string) => new PublicKey(s);
// Devnet program ids at the time the fixtures were captured (registry ids change per cluster; these don't).
const DEVNET = {
  pegDesk: pk("6jMv6pdi3nB4RRmJSojDy2cHRLMgKNM3ZEeJFngWrqQN"),
  feeRouter: pk("9bnCKVesMxQPDaWAmiT21vaES2QgtdXinfXciTCZrbEt"),
  distributor: pk("AEGw9dc3MUYR3aJXzZJjQmQDsJBJuT1RfsjoByNv4dV6"),
  usdc: pk("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  wallet: pk("4s7JvFDSt8ax5piX6CPKLG7u4fNDMkJxghopL7xYVgkq"),
  burgerMint: pk("8xzgCqrF2xWNjb1PJS7ncjDkFF4qm3ZxNAxRek8L85yM"),
};

describe("pda.ts derivations", () => {
  describe("SPL program ids", () => {
    it("match @solana/spl-token's canonical constants", () => {
      expect(TOKEN_PROGRAM.equals(TOKEN_PROGRAM_ID)).to.equal(true);
      expect(ASSOCIATED_TOKEN_PROGRAM.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).to.equal(true);
      expect(ASSOCIATED_TOKEN_PROGRAM.toBase58()).to.equal("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    });
    it("registry external program ids are the canonical mainnet deployments", () => {
      expect(PROGRAM_IDS.dbc).to.equal("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
      expect(PROGRAM_IDS.dammV2).to.equal("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
      expect(PROGRAM_IDS.pythReceiver).to.equal("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
      expect(PROGRAM_IDS.tokenMetadata).to.equal("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
      expect(USDC["mainnet-beta"]).to.equal("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      expect(USDC.devnet).to.equal("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
      for (const id of Object.values(PROGRAM_IDS)) expect(() => new PublicKey(id), id).to.not.throw();
    });
  });

  describe("ata()", () => {
    it("derives the devnet USDC ATA the spl-token CLI reports for the test wallet", () => {
      expect(ata(DEVNET.usdc, DEVNET.wallet).toBase58()).to.equal("44qCkzW4WHAhfo7XNV6UEeiP5Sy2URWhqGjWD9RkYyWF");
    });
    it("agrees with getAssociatedTokenAddressSync for random owners/mints, Token and Token-2022", () => {
      for (let i = 0; i < 25; i++) {
        const mint = Keypair.generate().publicKey;
        const owner = Keypair.generate().publicKey;
        expect(ata(mint, owner).equals(getAssociatedTokenAddressSync(mint, owner, true))).to.equal(true);
        expect(ata(mint, owner, TOKEN_2022_PROGRAM_ID).equals(getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID))).to.equal(true);
      }
    });
    it("argument order is (mint, owner) — swapping them changes the address", () => {
      expect(ata(DEVNET.wallet, DEVNET.usdc).equals(ata(DEVNET.usdc, DEVNET.wallet))).to.equal(false);
    });
  });

  describe("program PDAs (devnet fixtures)", () => {
    it("peg_desk GlobalConfig / commodity / mint_auth / reserve / keeper_price for BURGER", () => {
      expect(pegDesk.config(DEVNET.pegDesk)[0].toBase58()).to.equal("9E4VJpHEjkUgoNCMkwLDt5jzUVgD7jsvjU4myP6KdjRJ");
      const [commodity] = pegDesk.commodity(DEVNET.pegDesk, "BURGER");
      expect(commodity.toBase58()).to.equal("Akof8jiwcEbdhCiwrAjHhGpq4SzPzqppJ9TJf7VtVkBs");
      expect(pegDesk.mintAuth(DEVNET.pegDesk)[0].toBase58()).to.equal("6aAzMSfhvSC7DTprFdTmRv1TgVKMBy2dhWxSNiXY15PC");
      expect(pegDesk.reserve(DEVNET.pegDesk, commodity)[0].toBase58()).to.equal("9yjBKfzUkHWxHCsCaHqYHNodc6nBc6VibAMrkB2k29wc");
      expect(pegDesk.keeperPrice(DEVNET.pegDesk, commodity)[0].toBase58()).to.equal("4PfrrGFPRg3j5BF3rppxnmjPRS25qABwWNwkSUB8FuNR");
    });
    it("fee_router router + distributor config (initialized by scripts/init-programs.ts)", () => {
      expect(feeRouter.router(DEVNET.feeRouter)[0].toBase58()).to.equal("DgUPQKheM3SHj6jL83HqY7qqrjLAfeevWNBzZzaeACM5");
      expect(distributor.config(DEVNET.distributor)[0].toBase58()).to.equal("3qECcwdijb3TLGZKFXmcuSjHiBwedV6uPgSHXSZuVcVR");
    });
    it("every PDA helper returns a valid off-curve address with a bump", () => {
      const c = Keypair.generate().publicKey;
      const results: [PublicKey, number][] = [
        pegDesk.config(DEVNET.pegDesk),
        pegDesk.commodity(DEVNET.pegDesk, "GLD"),
        feeRouter.router(DEVNET.feeRouter),
        feeRouter.pool(DEVNET.feeRouter, c),
        distributor.config(DEVNET.distributor),
        distributor.distAuth(DEVNET.distributor),
        buyback.state(pk(PROGRAM_IDS.buyback)),
        buyback.authority(pk(PROGRAM_IDS.buyback)),
      ];
      for (const [addr, bump] of results) {
        expect(PublicKey.isOnCurve(addr.toBytes())).to.equal(false);
        expect(bump).to.be.within(0, 255);
      }
    });
  });

  describe("Meteora DBC pool address", () => {
    it("matches the Meteora SDK's deriveDbcPoolAddress(quote, base, config)", () => {
      for (let i = 0; i < 10; i++) {
        const config = Keypair.generate().publicKey;
        const base = Keypair.generate().publicKey;
        const quote = Keypair.generate().publicKey;
        expect(deriveDbcPoolAddress(config, base, quote).equals(meteoraDeriveDbcPoolAddress(quote, base, config))).to.equal(true);
      }
      // and the real $BG pool inputs (config from the launch's first tx, BURGER as quote)
      const cfg = pk("4Nmk35zv7piKY4oqJ8y5SLJmmUWmqpEGJ6t22tZHULig");
      expect(deriveDbcPoolAddress(cfg, DEVNET.burgerMint, DEVNET.usdc).equals(meteoraDeriveDbcPoolAddress(DEVNET.usdc, DEVNET.burgerMint, cfg))).to.equal(true);
    });
  });
});
