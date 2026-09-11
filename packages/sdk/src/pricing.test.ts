import { expect } from "chai";
import {
  Status,
  agePenaltyBps,
  confSpreadBps,
  spreadBps,
  askPrice,
  bidPrice,
  coinOutForUsdcIn,
  usdcOutForCoinIn,
  maxUsdcInForCoinOut,
  reserveRatioBps,
  quoteBuy,
  quoteSell,
  quoteBuyExactOut,
  applySlippageDown,
  applySlippageUp,
  type CommodityPricingParams,
} from "./pricing";

const GLD_PARAMS: CommodityPricingParams = {
  baseSpreadBps: 10n,
  closedSpreadBps: 10n,
  confMultBps: 50n,
  coinDecimals: 6,
  usdcDecimals: 6,
  reserveWarnBps: 10_200n,
  reserveHaltBps: 9_800n,
};

const PRICE_4000 = 4000_00000000n; // $4,000.00 at 1e8 scale

describe("pricing.ts (BigInt port of pricing.rs)", () => {
  describe("agePenaltyBps", () => {
    it("is zero at or below half of max_age", () => {
      expect(agePenaltyBps(0n, 60n, 10n)).to.equal(0n);
      expect(agePenaltyBps(30n, 60n, 10n)).to.equal(0n);
    });
    it("ramps linearly from half max_age to max_age", () => {
      // half=30, span=30; at age=45 (15/30 through the ramp) -> 10 * 15/30 = 5
      expect(agePenaltyBps(45n, 60n, 10n)).to.equal(5n);
    });
    it("rounds the ramp up (pricing.rs ceil)", () => {
      // ceil(20 * 1 / 30) = 1
      expect(agePenaltyBps(31n, 60n, 20n)).to.equal(1n);
    });
    it("clamps at base_spread_bps once age >= max_age", () => {
      expect(agePenaltyBps(60n, 60n, 10n)).to.equal(10n);
      expect(agePenaltyBps(120n, 60n, 10n)).to.equal(10n);
    });
  });

  describe("confSpreadBps", () => {
    it("is zero when conf is zero", () => {
      expect(confSpreadBps(0n, PRICE_4000, 50n)).to.equal(0n);
    });
    it("is 'bps per 1% of conf/price', rounded up (pricing.rs conf term)", () => {
      // conf = 0.1% of price, confMultBps = 50 bps per 1% -> +5 bps (same case as pricing.rs tests)
      const conf = PRICE_4000 / 1000n;
      expect(confSpreadBps(conf, PRICE_4000, 50n)).to.equal(5n);
      // conf = 10% of price -> 50 * 10 = 500 bps
      expect(confSpreadBps(PRICE_4000 / 10n, PRICE_4000, 50n)).to.equal(500n);
      // tiny conf still costs 1 bp when confMult > 0 (ceil)
      expect(confSpreadBps(1n, PRICE_4000, 50n)).to.equal(1n);
      // confMult 0 disables it
      expect(confSpreadBps(conf, PRICE_4000, 0n)).to.equal(0n);
    });
  });

  describe("spreadBps", () => {
    it("uses base_spread when open, closed_spread when closed", () => {
      const open = spreadBps({
        status: Status.Open,
        conf: 0n,
        price: PRICE_4000,
        ageSec: 0n,
        maxAgeSec: 60n,
        params: { ...GLD_PARAMS, baseSpreadBps: 10n, closedSpreadBps: 150n },
      });
      expect(open).to.equal(10n);
      const closed = spreadBps({
        status: Status.Closed,
        conf: 0n,
        price: PRICE_4000,
        ageSec: 0n,
        maxAgeSec: 60n,
        params: { ...GLD_PARAMS, baseSpreadBps: 10n, closedSpreadBps: 150n },
      });
      expect(closed).to.equal(150n);
    });
    it("doubles when reserveWarn is set", () => {
      const s = spreadBps({
        status: Status.Open,
        conf: 0n,
        price: PRICE_4000,
        ageSec: 0n,
        maxAgeSec: 60n,
        params: GLD_PARAMS,
        reserveWarn: true,
      });
      expect(s).to.equal(20n); // base 10 * 2
    });
    it("widens x2 from the pre-trade reserve ratio exactly like the program", () => {
      const common = { status: Status.Open, conf: 0n, price: PRICE_4000, ageSec: 0n, maxAgeSec: 60n, params: GLD_PARAMS };
      expect(spreadBps({ ...common, reserveRatioBps: 10_199n })).to.equal(20n);
      expect(spreadBps({ ...common, reserveRatioBps: 10_200n })).to.equal(10n);
      expect(spreadBps({ ...common, reserveRatioBps: null })).to.equal(10n); // no supply
    });
    it("is clamped to MAX_SPREAD_BPS (5000)", () => {
      const s = spreadBps({
        status: Status.Open, conf: PRICE_4000, price: PRICE_4000, ageSec: 0n, maxAgeSec: 60n, params: GLD_PARAMS,
      });
      expect(s).to.equal(5000n);
    });
  });

  describe("askPrice / bidPrice", () => {
    it("ask rounds up, bid rounds down (pricing.rs)", () => {
      expect(askPrice(3n, 1n)).to.equal(4n);
      expect(bidPrice(3n, 1n)).to.equal(2n);
    });
    it("ask is above price, bid is below, symmetric around p", () => {
      const ask = askPrice(PRICE_4000, 10n);
      const bid = bidPrice(PRICE_4000, 10n);
      expect(ask).to.be.above(PRICE_4000);
      expect(bid).to.be.below(PRICE_4000);
      expect(ask - PRICE_4000).to.equal(PRICE_4000 - bid);
    });
    it("bid floors at 0 for pathological spreads >= 10000 bps", () => {
      expect(bidPrice(PRICE_4000, 10_000n)).to.equal(0n);
      expect(bidPrice(PRICE_4000, 20_000n)).to.equal(0n);
    });
  });

  describe("coinOutForUsdcIn / usdcOutForCoinIn round-trip", () => {
    it("computes coin_out for a $100 buy at $4000/oz with 10bps spread", () => {
      const ask = askPrice(PRICE_4000, 10n); // 4004.00
      const usdcIn = 100_000000n; // $100
      const coinOut = coinOutForUsdcIn(usdcIn, ask, 6, 6);
      // ~0.024975... oz -> coin base units (6dp)
      expect(coinOut).to.be.above(0n);
      expect(coinOut).to.be.below(25000n); // < 0.025 coin
      expect(coinOut).to.be.above(24900n);
    });
    it("rounds down (floor), never overpays the user", () => {
      // pick numbers that don't divide evenly
      const ask = 3n; // tiny price to force remainder
      const usdcIn = 10n;
      const coinOut = coinOutForUsdcIn(usdcIn, ask, 6, 6);
      const exact = (usdcIn * 10n ** 6n * 10n ** 8n) / (ask * 10n ** 6n);
      expect(coinOut).to.equal(exact / 1n); // already integer division; sanity check no throw
      expect(coinOut * ask).to.be.at.most(usdcIn * 10n ** 8n); // never implies more value than paid
    });
    it("usdc_out rounds down symmetrically", () => {
      const bid = bidPrice(PRICE_4000, 10n);
      const coinIn = 25000n; // 0.025 coin
      const usdcOut = usdcOutForCoinIn(coinIn, bid, 6, 6);
      expect(usdcOut).to.be.above(0n);
      expect(usdcOut).to.be.below(100_000000n); // less than $100 since bid < price and rounds down
    });
  });

  describe("maxUsdcInForCoinOut", () => {
    it("rounds UP so the exact-out buy never under-funds", () => {
      const ask = askPrice(PRICE_4000, 10n);
      const coinOut = 24975n; // arbitrary, not a clean multiple
      const maxIn = maxUsdcInForCoinOut(coinOut, ask, 6, 6);
      // feeding maxIn back through coinOutForUsdcIn must yield >= coinOut
      const backOut = coinOutForUsdcIn(maxIn, ask, 6, 6);
      expect(backOut).to.be.at.least(coinOut);
      // and one base unit less must NOT be enough (tight ceil, when there's a remainder)
      const numerator = coinOut * ask * 10n ** 6n;
      const denominator = 10n ** 6n * 10n ** 8n;
      if (numerator % denominator !== 0n) {
        const backOutMinusOne = coinOutForUsdcIn(maxIn - 1n, ask, 6, 6);
        expect(backOutMinusOne).to.be.below(coinOut);
      }
    });
  });

  describe("reserveRatioBps", () => {
    it("returns 10_000 (100%) for exact 1:1 backing", () => {
      // supply=1 coin (1e6 units) at price $4000 (4000*1e8) -> liability = $4000 = 4000_000000 usdc units
      const supply = 1_000000n;
      const reserve = 4000_000000n;
      expect(reserveRatioBps(reserve, supply, PRICE_4000)).to.equal(10_000n);
    });
    it("returns null when supply is zero (Rust: u64::MAX sentinel)", () => {
      expect(reserveRatioBps(0n, 0n, PRICE_4000)).to.equal(null);
    });
    it("drops below reserve_halt_bps when reserve is short after a price rally", () => {
      const supply = 1_000000n;
      const reserve = 4000_000000n; // still only $4000 reserved
      const rallyPrice = 4200_00000000n; // price rallied to $4200
      const ratio = reserveRatioBps(reserve, supply, rallyPrice)!;
      expect(ratio).to.be.below(GLD_PARAMS.reserveHaltBps === 9_800n ? 9_800n : ratio); // sanity
      expect(ratio).to.be.below(10_000n);
    });
  });

  describe("quoteBuy / quoteSell / quoteBuyExactOut integration", () => {
    const spread: Parameters<typeof quoteBuy>[1] = {
      status: Status.Open,
      conf: 0n,
      price: PRICE_4000,
      ageSec: 0n,
      maxAgeSec: 60n,
      params: GLD_PARAMS,
    };

    it("quoteBuy then quoteBuyExactOut for the same coinOut yields a consistent max_usdc_in", () => {
      const usdcIn = 100_000000n;
      const buy = quoteBuy(usdcIn, spread);
      const exactOut = quoteBuyExactOut(buy.coinOut, spread);
      expect(exactOut.maxUsdcIn).to.be.at.most(usdcIn); // ceil of a slightly smaller amount than what produced coinOut
    });

    it("quoteSell of the bought amount returns less USDC than was paid (spread cost, round trip)", () => {
      const usdcIn = 1000_000000n;
      const buy = quoteBuy(usdcIn, spread);
      const sell = quoteSell(buy.coinOut, spread);
      expect(sell.usdcOut).to.be.below(usdcIn);
    });
  });

  describe("applySlippageDown / applySlippageUp", () => {
    it("down reduces by bps, up increases by bps", () => {
      expect(applySlippageDown(10_000n, 100n)).to.equal(9_900n); // 1%
      expect(applySlippageUp(10_000n, 100n)).to.equal(10_100n); // 1%
    });
    it("handles 0 bps as identity", () => {
      expect(applySlippageDown(12345n, 0n)).to.equal(12345n);
      expect(applySlippageUp(12345n, 0n)).to.equal(12345n);
    });
  });
});
