/**
 * Anchor event decoding from program logs (`Program data: <base64>` lines written by `emit!`), using the
 * IDL JSON read at RUNTIME from `target/idl/<name>.json` (override with `IDL_DIR`) — same convention as
 * apps/keeper/src/programs.ts, so the indexer needs no code change after `anchor build`.
 *
 * `EventParser` tracks the `Program <id> invoke` / `success` stack, so only events emitted by the
 * given program id are attributed to it (a CPI from fee_router into distributor is decoded once, under
 * the distributor).
 *
 * // CHECK vs @coral-xyz/anchor 0.31: `new BorshCoder(idl)`, `new EventParser(programId, coder)` and
 * // `parser.parseLogs(logs, errorOnDecodeFailure)` (a generator of `{ name, data }`) — transcribed from
 * // the 0.30+/0.31 TS client; not compiled against the installed package here (no network).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "@icemarkets/registry";
import { toIcemarketsEvent, type IcemarketsEvent, type ProgramName, type RawAnchorEvent } from "./events";

const IDL_FILE: Record<ProgramName, string> = {
  peg_desk: "peg_desk.json",
  fee_router: "fee_router.json",
  distributor: "distributor.json",
  buyback: "buyback.json",
};

/** Program ids: `.env` (same names as the keeper) → registry placeholders. */
export function programIds(): Record<ProgramName, string> {
  return {
    peg_desk: process.env.PEG_DESK_PROGRAM_ID ?? PROGRAM_IDS.pegDesk,
    fee_router: process.env.FEE_ROUTER_PROGRAM_ID ?? PROGRAM_IDS.feeRouter,
    distributor: process.env.DISTRIBUTOR_PROGRAM_ID ?? PROGRAM_IDS.distributor,
    buyback: process.env.BUYBACK_PROGRAM_ID ?? PROGRAM_IDS.buyback,
  };
}

export function idlDir(): string {
  // apps/indexer/src/decode -> repo root /target/idl
  return process.env.IDL_DIR ?? path.resolve(__dirname, "..", "..", "..", "..", "target", "idl");
}

interface Parser {
  program: ProgramName;
  programId: string;
  parser: EventParser;
}

let parsers: Parser[] | null = null;
const missing: ProgramName[] = [];

/** Builds (once) one EventParser per program whose IDL is present. Missing IDLs are reported, not fatal. */
export function loadParsers(): Parser[] {
  if (parsers) return parsers;
  const ids = programIds();
  const out: Parser[] = [];
  for (const program of Object.keys(IDL_FILE) as ProgramName[]) {
    const file = path.join(idlDir(), IDL_FILE[program]);
    if (!existsSync(file)) {
      missing.push(program);
      continue;
    }
    const idl = JSON.parse(readFileSync(file, "utf8")) as Idl & { address?: string };
    const programId = ids[program];
    const coder = new BorshCoder({ ...idl, address: programId } as Idl);
    out.push({ program, programId, parser: new EventParser(new PublicKey(programId), coder) });
  }
  parsers = out;
  return out;
}

export function missingIdls(): readonly ProgramName[] {
  loadParsers();
  return missing;
}

/** Decodes every ICEmarkets event in `logs`, in log order per program, typed. Unknown events are dropped. */
export function decodeAnchorEvents(logs: readonly string[], onError?: (program: ProgramName, err: unknown) => void): IcemarketsEvent[] {
  const out: IcemarketsEvent[] = [];
  for (const p of loadParsers()) {
    // Cheap pre-filter: skip parsers for programs that never ran in this tx.
    if (!logs.some((l) => l.startsWith(`Program ${p.programId} invoke`))) continue;
    try {
      for (const e of p.parser.parseLogs([...logs], false)) {
        const raw: RawAnchorEvent = { program: p.program, name: e.name, data: e.data as Record<string, unknown> };
        try {
          const typed = toIcemarketsEvent(raw);
          if (typed) out.push(typed);
        } catch (err) {
          onError?.(p.program, err);
        }
      }
    } catch (err) {
      onError?.(p.program, err);
    }
  }
  return out;
}
