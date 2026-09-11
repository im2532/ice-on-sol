import { expect } from "chai";
import { expectBig } from "./testUtils";
import { computeTwab, computeShares, type BalanceEvent } from "./twab";

describe("twab.ts", () => {
  describe("computeTwab", () => {
    it("gives full weight to a balance held for the whole epoch", () => {
      const events: BalanceEvent[] = [{ pool: "p", wallet: "w1", delta: 1000n, ts: 0 }]; // bought before epoch start
      const twab = computeTwab(events, { start: 100, end: 200 });
      expect(twab.get("w1")).to.equal(1000n);
    });

    it("gives partial weight to a buy mid-epoch", () => {
      // epoch [0, 100); wallet buys 1000 at ts=50 -> held for 50/100 of the epoch
      const events: BalanceEvent[] = [{ pool: "p", wallet: "w1", delta: 1000n, ts: 50 }];
      const twab = computeTwab(events, { start: 0, end: 100 });
      expect(twab.get("w1")).to.equal(500n); // 1000 * 50 / 100
    });

    it("gives partial weight to a sell mid-epoch (balance present at start, sold partway)", () => {
      // held 1000 from before epoch, sells all 1000 at ts=25 in a [0,100) epoch
      const events: BalanceEvent[] = [
        { pool: "p", wallet: "w1", delta: 1000n, ts: -10 },
        { pool: "p", wallet: "w1", delta: -1000n, ts: 25 },
      ];
      const twab = computeTwab(events, { start: 0, end: 100 });
      // held 1000 for 25s, then 0 for 75s -> (1000*25 + 0*75)/100 = 250
      expect(twab.get("w1")).to.equal(250n);
    });

    it("handles multiple buys and sells within the epoch", () => {
      // [0, 100): buy 100 at t=0, buy 100 more at t=50 (bal=200 for t in [50,100))
      const events: BalanceEvent[] = [
        { pool: "p", wallet: "w1", delta: 100n, ts: 0 },
        { pool: "p", wallet: "w1", delta: 100n, ts: 50 },
      ];
      const twab = computeTwab(events, { start: 0, end: 100 });
      // 100*50 + 200*50 = 5000+10000=15000 / 100 = 150
      expect(twab.get("w1")).to.equal(150n);
    });

    it("excludes a wallet with zero balance throughout the epoch", () => {
      const events: BalanceEvent[] = [
        { pool: "p", wallet: "w1", delta: 1000n, ts: -10 },
        { pool: "p", wallet: "w1", delta: -1000n, ts: -5 }, // fully exited before epoch starts
      ];
      const twab = computeTwab(events, { start: 0, end: 100 });
      expect(twab.has("w1")).to.equal(false);
    });

    it("excludes addresses in the exclude set (pool vaults, burn, program PDAs)", () => {
      const events: BalanceEvent[] = [
        { pool: "p", wallet: "poolVault", delta: 1_000_000n, ts: -10 },
        { pool: "p", wallet: "w1", delta: 1000n, ts: -10 },
      ];
      const twab = computeTwab(events, { start: 0, end: 100, exclude: ["poolVault"] });
      expect(twab.has("poolVault")).to.equal(false);
      expect(twab.get("w1")).to.equal(1000n);
    });

    it("computes independently across multiple wallets", () => {
      const events: BalanceEvent[] = [
        { pool: "p", wallet: "w1", delta: 1000n, ts: -10 },
        { pool: "p", wallet: "w2", delta: 2000n, ts: 50 }, // half weight
      ];
      const twab = computeTwab(events, { start: 0, end: 100 });
      expect(twab.get("w1")).to.equal(1000n);
      expect(twab.get("w2")).to.equal(1000n); // 2000 * 50/100
    });

    it("throws when end <= start", () => {
      expect(() => computeTwab([], { start: 100, end: 100 })).to.throw();
      expect(() => computeTwab([], { start: 100, end: 50 })).to.throw();
    });
  });

  describe("computeShares", () => {
    it("splits total pro-rata by TWAB and the shares sum exactly to totalAmount", () => {
      const twab = new Map<string, bigint>([
        ["w1", 1000n],
        ["w2", 3000n],
      ]);
      // price $1.00 (1e8), coinDecimals=6 -> minHoldingUsd in base units = 5 * 1e6 = 5_000_000, way above these TWABs
      // use a tiny price and low minHolding so both qualify
      const shares = computeShares(twab, 1_000_000n, { minHoldingUsd: 0, priceUsd8: 1_00000000n, coinDecimals: 6 });
      let sum = 0n;
      for (const v of shares.values()) sum += v;
      expect(sum).to.equal(1_000_000n);
      // w2 has 3x the twab of w1
      expectBig(shares.get("w2")! / shares.get("w1")!).atLeast(2n);
    });

    it("excludes wallets below minHoldingUsd", () => {
      const twab = new Map<string, bigint>([
        ["whale", 1_000_000_000n], // huge
        ["dust", 1n], // 1 base unit, effectively $0
      ]);
      const shares = computeShares(twab, 1000n, { minHoldingUsd: 5, priceUsd8: 1_00000000n, coinDecimals: 6 });
      expect(shares.has("dust")).to.equal(false);
      expect(shares.get("whale")).to.equal(1000n);
    });

    it("returns an empty map when no wallet meets the minimum", () => {
      const twab = new Map<string, bigint>([["w1", 1n]]);
      const shares = computeShares(twab, 1000n, { minHoldingUsd: 1_000_000, priceUsd8: 1_00000000n, coinDecimals: 6 });
      expect(shares.size).to.equal(0);
    });

    it("gives rounding remainder to the largest holder so the sum is exact", () => {
      const twab = new Map<string, bigint>([
        ["a", 1n],
        ["b", 1n],
        ["c", 1n],
      ]);
      const total = 10n; // 10/3 doesn't divide evenly
      const shares = computeShares(twab, total, { minHoldingUsd: 0, priceUsd8: 1n, coinDecimals: 0 });
      let sum = 0n;
      for (const v of shares.values()) sum += v;
      expect(sum).to.equal(total);
    });
  });
});
