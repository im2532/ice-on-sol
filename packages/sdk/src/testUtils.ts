import { expect } from "chai";

/**
 * chai 4's `above/below/at.least/at.most` accept only `number | Date` (types and runtime), so bigint
 * comparisons in tests go through this helper instead.
 */
export function expectBig(actual: bigint) {
  return {
    above: (n: bigint) => expect(actual > n, `expected ${actual} to be above ${n}`).to.equal(true),
    below: (n: bigint) => expect(actual < n, `expected ${actual} to be below ${n}`).to.equal(true),
    atLeast: (n: bigint) => expect(actual >= n, `expected ${actual} to be at least ${n}`).to.equal(true),
    atMost: (n: bigint) => expect(actual <= n, `expected ${actual} to be at most ${n}`).to.equal(true),
  };
}
