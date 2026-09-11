/**
 * Cross-checks every `program.methods.<ix>(...).accountsPartial({...})` (and `.accountsStrict` /
 * `.accounts`) call in the SDK / keeper / scripts / tests / web against the REAL Anchor-generated
 * IDLs in `target/idl/*.json`. Pure Node (fs/path only); a tolerant regex + brace-matching scan, not
 * a full TS parser — good enough to catch camelCase drift, dropped/renamed accounts, and arg-count
 * mismatches between the SDK and the compiled programs.
 *
 * Run with: tsx scripts/check-sdk-vs-idl.ts
 * Typecheck with: tsc --ignoreConfig --strict --skipLibCheck --noEmit --target es2022 --module commonjs --moduleResolution node scripts/check-sdk-vs-idl.ts
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// IDL loading
// ---------------------------------------------------------------------------

type IdlAccount = {
  name: string;
  pda?: unknown;
  address?: string;
  optional?: boolean;
  accounts?: IdlAccount[]; // nested composite account groups (not used by these 4 IDLs, but be safe)
};

type IdlArg = { name: string };

type IdlInstruction = {
  name: string;
  accounts: IdlAccount[];
  args: IdlArg[];
};

type IdlEventField = { name: string };
type IdlType = { name: string; type?: { kind: string; fields?: IdlEventField[] } };
type IdlEvent = { name: string };

type Idl = {
  instructions: IdlInstruction[];
  events?: IdlEvent[];
  types?: IdlType[];
};

const PROGRAM_NAMES = ["peg_desk", "fee_router", "distributor", "buyback"] as const;
type ProgramName = (typeof PROGRAM_NAMES)[number];

/** snake_case -> camelCase, exactly as Anchor 0.31's TS client does it (including a leading `_`). */
function camel(snake: string): string {
  return snake.replace(/_([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Flattens nested account groups (none expected here, but the IDL type allows them). */
function flattenAccounts(accounts: IdlAccount[]): IdlAccount[] {
  const out: IdlAccount[] = [];
  for (const a of accounts) {
    if (a.accounts) out.push(...flattenAccounts(a.accounts));
    else out.push(a);
  }
  return out;
}

interface InstrInfo {
  snakeName: string;
  camelName: string;
  accounts: { camel: string; snake: string; omittable: boolean; reason: string }[];
  argsLen: number;
}

interface ProgramIndex {
  name: ProgramName;
  idl: Idl;
  byCamel: Map<string, InstrInfo>;
  eventFieldsByCamelName: Map<string, Set<string>>; // camelEventName -> set of camel field names
  eventNames: Set<string>; // canonical (PascalCase, as in IDL) event names
}

function loadIdl(name: ProgramName): Idl {
  const file = path.join(ROOT, "target", "idl", `${name}.json`);
  if (!existsSync(file)) throw new Error(`missing IDL: ${file} (run \`anchor build\` first)`);
  return JSON.parse(readFileSync(file, "utf8")) as Idl;
}

function buildIndex(name: ProgramName): ProgramIndex {
  const idl = loadIdl(name);
  const byCamel = new Map<string, InstrInfo>();
  for (const ix of idl.instructions) {
    const accounts = flattenAccounts(ix.accounts).map((a) => {
      const hasPda = a.pda !== undefined;
      const hasAddress = a.address !== undefined;
      const optional = a.optional === true;
      const omittable = hasPda || hasAddress || optional;
      const reason = hasAddress ? "well-known (address)" : hasPda ? "PDA-derivable" : optional ? "optional" : "";
      return { camel: camel(a.name), snake: a.name, omittable, reason };
    });
    const info: InstrInfo = { snakeName: ix.name, camelName: camel(ix.name), accounts, argsLen: ix.args.length };
    byCamel.set(info.camelName, info);
  }
  const eventFieldsByCamelName = new Map<string, Set<string>>();
  const eventNames = new Set<string>((idl.events ?? []).map((e) => e.name));
  const typesByName = new Map<string, IdlType>((idl.types ?? []).map((t) => [t.name, t]));
  for (const ev of idl.events ?? []) {
    const t = typesByName.get(ev.name);
    const fields = t?.type?.kind === "struct" ? (t.type.fields ?? []) : [];
    eventFieldsByCamelName.set(camel(ev.name.length > 0 ? ev.name[0].toLowerCase() + ev.name.slice(1) : ev.name), new Set(fields.map((f) => camel(f.name))));
    eventFieldsByCamelName.set(ev.name, new Set(fields.map((f) => camel(f.name))));
  }
  return { name, idl, byCamel, eventFieldsByCamelName, eventNames };
}

const INDEX: Record<ProgramName, ProgramIndex> = {
  peg_desk: buildIndex("peg_desk"),
  fee_router: buildIndex("fee_router"),
  distributor: buildIndex("distributor"),
  buyback: buildIndex("buyback"),
};

/** Method (camelCase instruction) names that exist in exactly one program — used to disambiguate calls. */
const UNIQUE_METHOD_OWNER = new Map<string, ProgramName>();
{
  const seen = new Map<string, ProgramName[]>();
  for (const p of PROGRAM_NAMES) {
    for (const camelName of INDEX[p].byCamel.keys()) {
      seen.set(camelName, [...(seen.get(camelName) ?? []), p]);
    }
  }
  for (const [name, owners] of seen) if (owners.length === 1) UNIQUE_METHOD_OWNER.set(name, owners[0]);
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function targetFiles(): string[] {
  const explicit = [
    "packages/sdk/src/pegDesk.ts",
    "packages/sdk/src/feeRouter.ts",
    "packages/sdk/src/distributor.ts",
    "packages/sdk/src/buyback.ts",
    "apps/web/lib/actions.ts",
  ].map((p) => path.join(ROOT, p));
  const scripts = walk(path.join(ROOT, "scripts")).filter((f) => path.dirname(f) === path.join(ROOT, "scripts"));
  const tests = walk(path.join(ROOT, "tests")).filter((f) => path.dirname(f) === path.join(ROOT, "tests"));
  const keeper = walk(path.join(ROOT, "apps", "keeper", "src"));
  const all = [...explicit, ...scripts, ...tests, ...keeper].filter((f) => existsSync(f));
  const self = path.resolve(__filename);
  return [...new Set(all)].filter((f) => path.resolve(f) !== self);
}

// ---------------------------------------------------------------------------
// Tolerant brace/paren matching
// ---------------------------------------------------------------------------

/**
 * Blanks out `//` and `/* *​/` comments with spaces (preserving newlines and overall string length,
 * so line numbers and bracket offsets computed on the result still line up with the original file).
 * Skips comment-like sequences inside string/template literals.
 */
function stripComments(text: string): string {
  const out = text.split("");
  let inStr: string | null = null;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "/" && out[i + 1] === "/") {
      while (i < out.length && out[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      i--;
      continue;
    }
    if (c === "/" && out[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < out.length && !(out[i] === "*" && out[i + 1] === "/")) {
        if (out[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < out.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
      }
      continue;
    }
  }
  return out.join("");
}

/** Given `text` and the index of an opening bracket (one of `([{`), returns the index of its match. */
function matchBracket(text: string, openIdx: number): number {
  const open = text[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) throw new Error(`matchBracket: not an opener at ${openIdx}`);
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1; // unmatched (tolerated — caller treats as "give up")
}

/** Top-level (depth-1) comma-separated segments of `text[open+1 .. close]` (open/close inclusive indices of the brackets). */
function splitTopLevel(text: string, open: number, close: number): string[] {
  const inner = text.slice(open + 1, close);
  const segs: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      segs.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  const last = inner.slice(start);
  if (last.trim().length > 0) segs.push(last);
  return segs.map((s) => s.trim()).filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Same-file function/method body index, for resolving `...spreadCall(...)` account keys
// ---------------------------------------------------------------------------

interface FuncDef {
  name: string;
  /** Index right after the definition's signature (`name(...)` / `name = (...) =>`), to search forward from. */
  searchFrom: number;
}

/**
 * Finds candidate function/method/arrow-const definitions: `name(...) {` (methods, incl. private/
 * async/static and an optional `: ReturnType` — which may itself contain braces, e.g. an inline
 * object type — before the body's `{`), and `const name = (...) => ...`. Not preceded by `.` so
 * plain call sites (`this.name(...)`, `obj.name(...)`) are excluded; a bare call like `foo(...)` can
 * still match, but in this codebase every helper we need to resolve is defined before it is ever
 * spread-called, and we keep the FIRST match per name, so real call sites never shadow the definition.
 */
function indexFunctions(text: string): Map<string, FuncDef> {
  const out = new Map<string, FuncDef>();
  const re = /(?:^|[^.\w$])(?:private\s+|public\s+|protected\s+|readonly\s+|async\s+|static\s+|const\s+|let\s+|function\s+)*([A-Za-z_$][\w$]*)\s*(?:=\s*)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (["if", "for", "while", "switch", "catch", "function", "return"].includes(name)) continue;
    if (out.has(name)) continue; // keep first occurrence (the definition, in this codebase's style)
    out.set(name, { name, searchFrom: m.index + m[0].length - 1 });
  }
  return out;
}

/** Finds the object literal a function/arrow at `searchFrom` returns, within a bounded lookahead window. */
function findReturnedObject(text: string, searchFrom: number): { open: number; close: number } | null {
  const window = text.slice(searchFrom, searchFrom + 4000);
  const patterns = [/return\s*\(?\s*\{/, /=>\s*\(\s*\{/];
  let best: RegExpMatchArray | null = null;
  for (const p of patterns) {
    const m = window.match(p);
    if (m && m.index !== undefined && (!best || m.index < (best.index ?? Infinity))) best = m;
  }
  if (!best || best.index === undefined) return null;
  const openIdx = searchFrom + best.index + best[0].length - 1;
  const closeIdx = matchBracket(text, openIdx);
  if (closeIdx === -1) return null;
  return { open: openIdx, close: closeIdx };
}

/**
 * Best-effort resolution of the account-key set for one `.accountsPartial(<expr>)` argument
 * expression. Handles: object literals (incl. nested `...spreadCall(...)` and `...identifier`
 * spreads resolved against same-file function bodies), and a bare call expression whose function
 * body's `return { ... }` (or arrow implicit-return `=> ({ ... })`) is itself resolved the same way.
 */
function resolveKeys(text: string, expr: string, funcs: Map<string, FuncDef>, visited: Set<string>, unresolved: string[]): Set<string> {
  const e = expr.trim();
  if (e.startsWith("{")) {
    const close = matchBracket(e, 0);
    if (close === -1) return new Set();
    const keys = new Set<string>();
    for (const seg of splitTopLevel(e, 0, close)) {
      if (seg.startsWith("...")) {
        const sub = seg.slice(3).trim();
        for (const k of resolveKeys(text, sub, funcs, visited, unresolved)) keys.add(k);
        continue;
      }
      const colon = findTopLevelColon(seg);
      if (colon === -1) {
        // shorthand property `{ foo }`
        const ident = seg.match(/^[A-Za-z_$][\w$]*/);
        if (ident) keys.add(ident[0]);
      } else {
        keys.add(seg.slice(0, colon).trim().replace(/^["'`]|["'`]$/g, ""));
      }
    }
    return keys;
  }
  // call expression: `this.foo(...)` or `foo(...)` or `bar.foo(...)`
  const callMatch = e.match(/^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/);
  if (callMatch) {
    const fname = callMatch[1];
    if (visited.has(fname)) return new Set();
    visited.add(fname);
    const def = funcs.get(fname);
    if (!def) {
      unresolved.push(fname);
      return new Set();
    }
    const ret = findReturnedObject(text, def.searchFrom);
    if (!ret) {
      unresolved.push(fname);
      return new Set();
    }
    return resolveKeys(text, text.slice(ret.open, ret.close + 1), funcs, visited, unresolved);
  }
  unresolved.push(e.slice(0, 40));
  return new Set();
}

function findTopLevelColon(seg: string): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Program-context resolution (which IDL a `.methods.<ix>(` call belongs to)
// ---------------------------------------------------------------------------

const PASCAL_TO_SNAKE: Record<string, ProgramName> = {
  PegDesk: "peg_desk",
  FeeRouter: "fee_router",
  Distributor: "distributor",
  Buyback: "buyback",
};

function fileDefaultProgram(file: string): ProgramName | null {
  const base = path.basename(file);
  if (base === "pegDesk.ts" || base === "peg_desk.test.ts") return "peg_desk";
  if (base === "feeRouter.ts") return "fee_router";
  if (base === "distributor.ts" || base === "distributor.test.ts") return "distributor";
  if (base === "buyback.ts") return "buyback";
  return null;
}

function findBindings(text: string): Map<string, ProgramName> {
  const bindings = new Map<string, ProgramName>();
  const reGetProgram = /(?:const|let)\s+(\w+)\s*=\s*getProgram\(\s*["'](\w+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = reGetProgram.exec(text))) {
    if ((PROGRAM_NAMES as readonly string[]).includes(m[2])) bindings.set(m[1], m[2] as ProgramName);
  }
  const reWorkspace = /(?:const|let)\s+(\w+)\s*=\s*(?:\(anchor\.workspace(?:\s+as\s+any)?\)|anchor\.workspace)\.(\w+)/g;
  while ((m = reWorkspace.exec(text))) {
    const p = PASCAL_TO_SNAKE[m[2]];
    if (p) bindings.set(m[1], p);
  }
  return bindings;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

interface Finding {
  file: string;
  line: number;
  message: string;
}

const findings: Finding[] = [];

function lineOf(text: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function checkFile(file: string): void {
  const text = stripComments(readFileSync(file, "utf8"));
  const rel = path.relative(ROOT, file);
  const bindings = findBindings(text);
  const defaultProgram = fileDefaultProgram(file);
  const funcs = indexFunctions(text);

  // Match: <receiver>.methods.<ixName>(  where receiver is `getProgram("x")`, `this.program`, or a bare identifier.
  const re = /(getProgram\(\s*["'](\w+)["']\s*\)|this\.program|[A-Za-z_$][\w$]*)\s*\.methods\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const receiver = m[1];
    const ixCamel = m[3];
    const line = lineOf(text, m.index);

    // ---- resolve program ----
    let prog: ProgramName | null = null;
    const gpMatch = receiver.match(/^getProgram\(\s*["'](\w+)["']\s*\)$/);
    if (gpMatch && (PROGRAM_NAMES as readonly string[]).includes(gpMatch[1])) {
      prog = gpMatch[1] as ProgramName;
    } else if (receiver === "this.program") {
      prog = defaultProgram;
    } else {
      prog = bindings.get(receiver) ?? defaultProgram;
    }
    if (!prog) prog = UNIQUE_METHOD_OWNER.get(ixCamel) ?? null;
    if (!prog) {
      findings.push({ file: rel, line, message: `could not resolve which program \`.methods.${ixCamel}(\` targets (receiver "${receiver}"); skipped` });
      continue;
    }

    const idx = INDEX[prog];
    const info = idx.byCamel.get(ixCamel);
    if (!info) {
      findings.push({ file: rel, line, message: `${prog}: method \`.${ixCamel}(\` does not exist in the IDL (no matching instruction)` });
      continue;
    }

    // ---- args count ----
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchBracket(text, openParen);
    if (closeParen === -1) {
      findings.push({ file: rel, line, message: `${prog}.${ixCamel}: unmatched '(' while scanning args — skipped` });
      continue;
    }
    const argSegs = splitTopLevel(text, openParen, closeParen);
    if (argSegs.length !== info.argsLen) {
      findings.push({
        file: rel,
        line,
        message: `${prog}.${ixCamel}: called with ${argSegs.length} arg(s) but IDL expects ${info.argsLen} (${info.snakeName} args: [${info.snakeName === ixCamel ? "" : ""}])`,
      });
    }

    // ---- find the accounts call following .methods.ixName(...) ----
    let cursor = closeParen + 1;
    let accountsExpr: string | null = null;
    let accountsCallKind = "";
    for (let hop = 0; hop < 8; hop++) {
      const chain = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(cursor));
      if (!chain) break;
      const callName = chain[1];
      const callOpen = cursor + chain[0].length - 1;
      const callClose = matchBracket(text, callOpen);
      if (callClose === -1) break;
      if (callName === "accountsPartial" || callName === "accountsStrict" || callName === "accounts") {
        accountsExpr = text.slice(callOpen + 1, callClose);
        accountsCallKind = callName;
        cursor = callClose + 1;
        break;
      }
      cursor = callClose + 1;
    }

    if (accountsExpr === null) {
      // Not necessarily wrong (some builders may rely on defaults), but flag it since every real
      // instruction call in this codebase supplies accounts explicitly.
      findings.push({ file: rel, line, message: `${prog}.${ixCamel}: no .accountsPartial/.accountsStrict/.accounts(...) found after .methods.${ixCamel}(...)` });
      continue;
    }

    const unresolved: string[] = [];
    const providedCamel = resolveKeys(text, accountsExpr, funcs, new Set(), unresolved);

    const validCamel = new Set(info.accounts.map((a) => a.camel));
    for (const key of providedCamel) {
      if (!validCamel.has(key)) {
        findings.push({ file: rel, line, message: `${prog}.${ixCamel}: unknown account key "${key}" passed to .${accountsCallKind}({...}) (not in IDL)` });
      }
    }
    if (accountsCallKind !== "accountsPartial") {
      // accountsStrict/accounts must list every account; accountsPartial may omit PDA/well-known/optional ones.
      for (const a of info.accounts) {
        if (!providedCamel.has(a.camel) && !a.omittable) {
          findings.push({ file: rel, line, message: `${prog}.${ixCamel}: missing required account "${a.camel}" in .${accountsCallKind}({...})` });
        }
      }
    } else {
      const missing = info.accounts.filter((a) => !providedCamel.has(a.camel) && !a.omittable);
      if (missing.length > 0) {
        findings.push({
          file: rel,
          line,
          message: `${prog}.${ixCamel}: accountsPartial is missing non-derivable account(s): ${missing.map((a) => a.camel).join(", ")}`,
        });
      }
    }
    if (unresolved.length > 0) {
      findings.push({
        file: rel,
        line,
        message: `${prog}.${ixCamel}: could not statically resolve account key(s) from: ${[...new Set(unresolved)].join(", ")} (spread of an un-indexed helper) — account-key check for those is incomplete`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Event name/field spot-check (apps/indexer/src/decode/anchorEvents.ts + events.ts, apps/keeper)
// ---------------------------------------------------------------------------

function checkEventUsage(): void {
  const candidates = [
    path.join(ROOT, "apps", "indexer", "src", "decode", "anchorEvents.ts"),
    path.join(ROOT, "apps", "indexer", "src", "decode", "events.ts"),
    ...walk(path.join(ROOT, "apps", "keeper", "src")),
  ].filter((f) => existsSync(f));

  // event name string literals compared against e.name (e.g. `e.name === "FeesClaimed"`)
  const reEventNameEq = /\.name\s*===?\s*["']([A-Za-z][\w]*)["']/g;
  const allEventNames = new Set<string>();
  for (const p of PROGRAM_NAMES) for (const n of INDEX[p].idl.events ?? []) allEventNames.add(n.name);

  for (const file of candidates) {
    const text = stripComments(readFileSync(file, "utf8"));
    const rel = path.relative(ROOT, file);
    let m: RegExpExecArray | null;
    while ((m = reEventNameEq.exec(text))) {
      const name = m[1];
      // Only flag names that look like PascalCase event names (heuristic: starts uppercase) and
      // are not present in ANY of the four IDLs (case-insensitive, since Anchor may lower-first).
      if (!/^[A-Z]/.test(name)) continue;
      const found = [...allEventNames].some((n) => n === name);
      if (!found) {
        findings.push({ file: rel, line: lineOf(text, m.index), message: `event name "${name}" does not match any IDL event across the four programs` });
      }
    }
  }

  // field(d, "snake_case") calls in events.ts, checked against each event's declared struct fields
  // by scanning the `case "program.EventName":` block each field() call falls under.
  const eventsFile = path.join(ROOT, "apps", "indexer", "src", "decode", "events.ts");
  if (existsSync(eventsFile)) {
    const text = stripComments(readFileSync(eventsFile, "utf8"));
    const rel = path.relative(ROOT, eventsFile);
    const caseRe = /case\s+"(\w+)\.(\w+)":/g;
    const cases: { program: ProgramName; event: string; index: number }[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = caseRe.exec(text))) {
      if ((PROGRAM_NAMES as readonly string[]).includes(cm[1])) cases.push({ program: cm[1] as ProgramName, event: cm[2], index: cm.index });
    }
    for (let i = 0; i < cases.length; i++) {
      const start = cases[i].index;
      const end = i + 1 < cases.length ? cases[i + 1].index : text.indexOf("default:", start);
      const block = text.slice(start, end === -1 ? text.length : end);
      const idl = INDEX[cases[i].program].idl;
      const typesByName = new Map<string, IdlType>((idl.types ?? []).map((t) => [t.name, t]));
      const t = typesByName.get(cases[i].event);
      const eventExists = (idl.events ?? []).some((e) => e.name === cases[i].event);
      if (!eventExists) {
        findings.push({ file: rel, line: lineOf(text, start), message: `event "${cases[i].program}.${cases[i].event}" does not exist in ${cases[i].program} IDL events[]` });
        continue;
      }
      const validSnake = new Set((t?.type?.kind === "struct" ? t.type.fields ?? [] : []).map((f) => f.name));
      const fieldRe = /field\(\s*d\s*,\s*["'](\w+)["']\s*\)/g;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRe.exec(block))) {
        if (!validSnake.has(fm[1])) {
          findings.push({
            file: rel,
            line: lineOf(text, start + fm.index),
            message: `event "${cases[i].program}.${cases[i].event}": field "${fm[1]}" not found in IDL type (fields: ${[...validSnake].join(", ")})`,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PDA seed spot-check (packages/sdk/src/pda.ts vs IDL `pda.seeds` const-byte seeds)
// ---------------------------------------------------------------------------

function bytesToAscii(bytes: number[]): string {
  return bytes.map((b) => String.fromCharCode(b)).join("");
}

function checkPdaSeeds(): void {
  const pdaFile = path.join(ROOT, "packages", "sdk", "src", "pda.ts");
  if (!existsSync(pdaFile)) return;
  const text = stripComments(readFileSync(pdaFile, "utf8"));
  const rel = path.relative(ROOT, pdaFile);

  // Collect every distinct const-byte first-seed string used per IDL instruction/account, per program.
  const idlConstSeeds = new Map<ProgramName, Set<string>>();
  for (const p of PROGRAM_NAMES) {
    const set = new Set<string>();
    for (const ix of INDEX[p].idl.instructions) {
      for (const a of flattenAccounts(ix.accounts)) {
        const pda = a.pda as { seeds?: { kind: string; value?: number[] }[] } | undefined;
        const first = pda?.seeds?.[0];
        if (first && first.kind === "const" && Array.isArray(first.value)) {
          set.add(bytesToAscii(first.value));
        }
      }
    }
    idlConstSeeds.set(p, set);
  }

  // Every `Buffer.from("literal")` used as a seed in pda.ts (best-effort: any string literal argument).
  const seedLiteralRe = /Buffer\.from\(\s*SEEDS\.(\w+)\.(\w+)\s*\)/g;
  let m: RegExpExecArray | null;
  const SDK_TO_IDL: Record<string, ProgramName> = { pegDesk: "peg_desk", feeRouter: "fee_router", distributor: "distributor", buyback: "buyback" };
  const usedNamespaces = new Set<string>();
  while ((m = seedLiteralRe.exec(text))) usedNamespaces.add(m[1]);

  // We can't resolve SEEDS.* string VALUES without reading @icemarkets/registry (not scanned per the
  // task's file list), so this check reports only structural drift it CAN see from pda.ts alone: every
  // `Buffer.from(SEEDS.<ns>.<key>)` namespace must correspond to a real program, and is left for a human
  // to cross-check the byte value against the printed IDL const seeds below when this script runs.
  for (const ns of usedNamespaces) {
    if (!SDK_TO_IDL[ns]) {
      findings.push({ file: rel, line: 1, message: `pda.ts: SEEDS namespace "${ns}" does not map to a known program` });
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  for (const file of targetFiles()) checkFile(file);
  checkEventUsage();
  checkPdaSeeds();

  console.log("=== check-sdk-vs-idl report ===\n");
  console.log(`Programs indexed: ${PROGRAM_NAMES.join(", ")}`);
  console.log(`Files scanned: ${targetFiles().length}\n`);

  if (findings.length === 0) {
    console.log("OK — no mismatches found between the SDK/keeper/scripts/tests/web and the IDLs.");
    process.exit(0);
  }

  for (const f of findings) {
    console.log(`${f.file}:${f.line}  ${f.message}`);
  }
  console.log(`\n${findings.length} mismatch(es) found.`);
  process.exit(1);
}

main();
