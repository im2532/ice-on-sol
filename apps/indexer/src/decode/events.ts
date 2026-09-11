/**
 * Typed ICEmarkets program events (docs/CONTRACTS.md §1–§4; Rust `events.rs` of each program) and the
 * conversion from Anchor's generic decoded `{ name, data }` into them. Pure — no Anchor import, so the
 * mapping is typechecked and unit-testable without the SDK installed.
 *
 * Anchor casing is normalized here: event names may come back as `Trade` or `trade`, and field names as
 * `spread_bps` (raw IDL through `BorshCoder`) or `spreadBps` (camelCased IDL through `Program.coder`) —
 * `field()` accepts both. Values: u64/u128/i64 → BN (anything with `toString()`), Pubkey → PublicKey
 * (anything with `toBase58()`), `[u8; N]` → number[].
 */

export type ProgramName = "peg_desk" | "fee_router" | "distributor" | "buyback";

/** Anchor's decoded event, before typing. */
export interface RawAnchorEvent {
  program: ProgramName;
  name: string;
  data: Record<string, unknown>;
}

export type IcemarketsEvent =
  // peg_desk
  | { program: "peg_desk"; kind: "CommodityCreated"; commodity: string; symbol: string; mint: string }
  | { program: "peg_desk"; kind: "Trade"; commodity: string; user: string; side: 0 | 1; usdc: bigint; coin: bigint; price: bigint; spreadBps: number }
  | { program: "peg_desk"; kind: "PriceUpdated"; commodity: string; price: bigint; conf: bigint; publishTime: bigint }
  | { program: "peg_desk"; kind: "StatusChanged"; commodity: string; status: number }
  // fee_router
  | { program: "fee_router"; kind: "PoolRegistered"; pool: string; baseMint: string; quoteMint: string; commodity: string; feeBps: number }
  | { program: "fee_router"; kind: "FeesClaimed"; pool: string; source: 0 | 1 | 2; quoteAmount: bigint; baseAmount: bigint }
  | { program: "fee_router"; kind: "FeesSplit"; pool: string; holders: bigint; buyback: bigint; protocol: bigint }
  | { program: "fee_router"; kind: "MigrationRecorded"; pool: string; dammPool: string }
  // distributor
  | { program: "distributor"; kind: "EpochOpened"; pool: string; index: number; total: bigint; holders: number }
  | { program: "distributor"; kind: "Payout"; pool: string; epoch: string; wallet: string; coinMint: string; amount: bigint; payoutKind: 0 | 1 }
  | { program: "distributor"; kind: "EpochFinalized"; pool: string; index: number; merkleRoot: string; remainder: bigint }
  // buyback
  | { program: "buyback"; kind: "Buyback"; coin: string; coinAmount: bigint; gldAmount: bigint; iceBurned: bigint };

export type EventKind = IcemarketsEvent["kind"];

// ---- field accessors --------------------------------------------------------------------------

function camel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function field(data: Record<string, unknown>, snake: string): unknown {
  if (snake in data) return data[snake];
  const c = camel(snake);
  if (c in data) return data[c];
  throw new Error(`event field "${snake}" missing (have: ${Object.keys(data).join(", ")})`);
}

export function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return BigInt(v);
  if (v && typeof (v as { toString?: unknown }).toString === "function") return BigInt((v as { toString(): string }).toString());
  throw new Error(`not an integer: ${String(v)}`);
}

export function asNumber(v: unknown): number {
  return Number(asBigInt(v));
}

export function asKey(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof (v as { toBase58?: unknown }).toBase58 === "function") return (v as { toBase58(): string }).toBase58();
  throw new Error(`not a pubkey: ${String(v)}`);
}

export function asBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v.map((x) => Number(x)));
  throw new Error(`not a byte array: ${String(v)}`);
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** `[u8; 12]` NUL-padded ASCII symbol → "GLD". */
export function symbolFromBytes(b: Uint8Array): string {
  let s = "";
  for (const x of b) {
    if (x === 0) break;
    s += String.fromCharCode(x);
  }
  return s;
}

const oneOf = <T extends number>(v: number, allowed: readonly T[], what: string): T => {
  if (!(allowed as readonly number[]).includes(v)) throw new Error(`${what}: unexpected value ${v}`);
  return v as T;
};

// ---- conversion -------------------------------------------------------------------------------

/** Normalizes an event name to the Rust struct name ("feesClaimed" → "FeesClaimed"). */
export function canonicalName(name: string): string {
  return name.length > 0 ? name[0].toUpperCase() + name.slice(1) : name;
}

/**
 * Types one decoded Anchor event. Returns null for events the indexer does not store (e.g.
 * `ParamsUpdated`, `KeepersSet`, `VaultWithdrawn`); throws if a known event has a malformed payload.
 */
export function toIcemarketsEvent(ev: RawAnchorEvent): IcemarketsEvent | null {
  const d = ev.data;
  const name = canonicalName(ev.name);
  switch (`${ev.program}.${name}`) {
    case "peg_desk.CommodityCreated":
      return { program: "peg_desk", kind: "CommodityCreated", commodity: asKey(field(d, "commodity")), symbol: symbolFromBytes(asBytes(field(d, "symbol"))), mint: asKey(field(d, "mint")) };
    case "peg_desk.Trade":
      return {
        program: "peg_desk",
        kind: "Trade",
        commodity: asKey(field(d, "commodity")),
        user: asKey(field(d, "user")),
        side: oneOf(asNumber(field(d, "side")), [0, 1] as const, "Trade.side"),
        usdc: asBigInt(field(d, "usdc")),
        coin: asBigInt(field(d, "coin")),
        price: asBigInt(field(d, "price")),
        spreadBps: asNumber(field(d, "spread_bps")),
      };
    case "peg_desk.PriceUpdated":
      return {
        program: "peg_desk",
        kind: "PriceUpdated",
        commodity: asKey(field(d, "commodity")),
        price: asBigInt(field(d, "price")),
        conf: asBigInt(field(d, "conf")),
        publishTime: asBigInt(field(d, "publish_time")),
      };
    case "peg_desk.StatusChanged":
      return { program: "peg_desk", kind: "StatusChanged", commodity: asKey(field(d, "commodity")), status: asNumber(field(d, "status")) };

    case "fee_router.PoolRegistered":
      return {
        program: "fee_router",
        kind: "PoolRegistered",
        pool: asKey(field(d, "pool")),
        baseMint: asKey(field(d, "base_mint")),
        quoteMint: asKey(field(d, "quote_mint")),
        commodity: asKey(field(d, "commodity")),
        feeBps: asNumber(field(d, "fee_bps")),
      };
    case "fee_router.FeesClaimed":
      return {
        program: "fee_router",
        kind: "FeesClaimed",
        pool: asKey(field(d, "pool")),
        source: oneOf(asNumber(field(d, "source")), [0, 1, 2] as const, "FeesClaimed.source"),
        quoteAmount: asBigInt(field(d, "quote_amount")),
        baseAmount: asBigInt(field(d, "base_amount")),
      };
    case "fee_router.FeesSplit":
      return {
        program: "fee_router",
        kind: "FeesSplit",
        pool: asKey(field(d, "pool")),
        holders: asBigInt(field(d, "holders")),
        buyback: asBigInt(field(d, "buyback")),
        protocol: asBigInt(field(d, "protocol")),
      };
    case "fee_router.MigrationRecorded":
      return { program: "fee_router", kind: "MigrationRecorded", pool: asKey(field(d, "pool")), dammPool: asKey(field(d, "damm_pool")) };

    case "distributor.EpochOpened":
      return {
        program: "distributor",
        kind: "EpochOpened",
        pool: asKey(field(d, "pool")),
        index: asNumber(field(d, "index")),
        total: asBigInt(field(d, "total")),
        holders: asNumber(field(d, "holders")),
      };
    case "distributor.Payout":
      return {
        program: "distributor",
        kind: "Payout",
        pool: asKey(field(d, "pool")),
        epoch: asKey(field(d, "epoch")),
        wallet: asKey(field(d, "wallet")),
        coinMint: asKey(field(d, "coin_mint")),
        amount: asBigInt(field(d, "amount")),
        payoutKind: oneOf(asNumber(field(d, "kind")), [0, 1] as const, "Payout.kind"),
      };
    case "distributor.EpochFinalized":
      return {
        program: "distributor",
        kind: "EpochFinalized",
        pool: asKey(field(d, "pool")),
        index: asNumber(field(d, "index")),
        merkleRoot: bytesToHex(asBytes(field(d, "merkle_root"))),
        remainder: asBigInt(field(d, "remainder")),
      };

    case "buyback.Buyback":
      return {
        program: "buyback",
        kind: "Buyback",
        coin: asKey(field(d, "coin")),
        coinAmount: asBigInt(field(d, "coin_amount")),
        gldAmount: asBigInt(field(d, "gld_amount")),
        iceBurned: asBigInt(field(d, "ice_burned")),
      };
    default:
      return null;
  }
}

/** Base units (6 decimals) → exact decimal string in human units, for numeric(30,6) columns. */
export function baseToHuman(v: bigint, decimals = 6): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const scale = 10n ** BigInt(decimals);
  const whole = a / scale;
  const frac = (a % scale).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** 1e8 fixed-point price → decimal string (numeric(20,8) columns). */
export function price1e8ToHuman(v: bigint): string {
  return baseToHuman(v, 8);
}
