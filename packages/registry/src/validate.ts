import { ALL, COMMODITIES, INDEX_COINS, OracleKind } from "./index";

const errors: string[] = [];
const seen = new Set<string>();
for (const c of ALL) {
  if (seen.has(c.symbol)) errors.push(`duplicate symbol ${c.symbol}`);
  seen.add(c.symbol);
  if (!/^[A-Z0-9]{2,12}$/.test(c.symbol)) errors.push(`${c.symbol}: symbol must be 2–12 uppercase alnum`);
  if (c.oracle.kind === OracleKind.PythPull) {
    if (!c.oracle.pythSymbol) errors.push(`${c.symbol}: pyth symbol missing`);
    if (c.oracle.feedId && !/^[0-9a-f]{64}$/.test(c.oracle.feedId)) errors.push(`${c.symbol}: bad feed id`);
    if (c.oracle.quote === "EUR" && !c.oracle.fxFeedId) errors.push(`${c.symbol}: EUR quote needs fxFeedId`);
  }
  if (c.oracle.kind === OracleKind.Switchboard && !c.oracle.switchboardJob) errors.push(`${c.symbol}: switchboard job missing`);
  if (c.oracle.kind === OracleKind.Composite) {
    const sum = (c.oracle.legs ?? []).reduce((a, l) => a + l.weightBps, 0);
    if (sum !== 10_000) errors.push(`${c.symbol}: legs sum ${sum} != 10000`);
    if ((c.oracle.legs ?? []).length > 5) errors.push(`${c.symbol}: >5 legs`);
    for (const l of c.oracle.legs ?? []) if (!COMMODITIES.find((x) => x.symbol === l.symbol)) errors.push(`${c.symbol}: unknown leg ${l.symbol}`);
    for (const l of c.oracle.legs ?? []) if (l.weightBps < 500) errors.push(`${c.symbol}: leg ${l.symbol} < 5%`);
  }
  const p = c.params;
  if (p.baseSpreadBps < 1 || p.baseSpreadBps > 1000) errors.push(`${c.symbol}: spread out of range`);
  if (p.maxAgeClosedSec < p.maxAgeOpenSec) errors.push(`${c.symbol}: closed max age < open`);
}
const drugs = ["COKE", "HEROIN", "METH", "FENT", "MOLLY", "WEED", "ACID", "SHROOMS", "KET", "CRACK", "OXY", "XAN"];
for (const d of drugs) if (seen.has(d)) errors.push(`excluded category present: ${d}`);

console.log(`registry: ${COMMODITIES.length} commodities + ${INDEX_COINS.length} index coins`);
console.log(`mvp: ${COMMODITIES.filter((c) => c.phase === "mvp").length}, v1.1: ${COMMODITIES.filter((c) => c.phase === "v1.1").length}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("registry OK");
