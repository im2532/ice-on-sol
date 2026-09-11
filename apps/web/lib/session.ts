/**
 * Trading-session calendar for UI copy ("opens in 3h 20m"). MIRRORS apps/keeper/src/cycles/session.ts
 * (the keeper flips `Commodity.status` Open↔Closed with that calendar) — keep the hours and the holiday
 * list in sync. The on-chain status stays the source of truth for what is tradable; this only predicts
 * when the keeper will re-open a Closed market.
 *
 *  - CmeGlobex: Sun 18:00 → Fri 17:00 America/New_York, daily 17:00–18:00 break, US holidays closed.
 *  - IceUs:     04:00–14:00 America/New_York, Mon–Fri, US holidays closed.
 *  - Lme:       01:00–19:00 Europe/London, Mon–Fri.
 *  - Continuous / Slow: always open.
 */
import { SessionKind } from "@icemarkets/registry";

/** Same list as the keeper's US_HOLIDAYS_2026 (CHECK there against CME's published calendar). */
const US_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

interface ZonedNow {
  weekday: number; // 0 = Sun
  hour: number;
  minute: number;
  dateKey: string; // YYYY-MM-DD in that zone
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zoned(date: Date, timeZone: string): ZonedNow {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = Number.parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return { weekday: WEEKDAY[get("weekday")] ?? 0, hour, minute: Number.parseInt(get("minute"), 10), dateKey: `${get("year")}-${get("month")}-${get("day")}` };
}

function isOpenCmeGlobex(date: Date): boolean {
  const z = zoned(date, "America/New_York");
  if (US_HOLIDAYS_2026.has(z.dateKey)) return false;
  const mins = z.hour * 60 + z.minute;
  const OPEN = 18 * 60;
  const CLOSE = 17 * 60;
  if (z.weekday === 5 && mins >= CLOSE) return false;
  if (z.weekday === 6) return false;
  if (z.weekday === 0 && mins < OPEN) return false;
  if (mins >= CLOSE && mins < OPEN) return false;
  return true;
}

function isOpenIceUs(date: Date): boolean {
  const z = zoned(date, "America/New_York");
  if (US_HOLIDAYS_2026.has(z.dateKey)) return false;
  if (z.weekday === 0 || z.weekday === 6) return false;
  const mins = z.hour * 60 + z.minute;
  return mins >= 4 * 60 && mins < 14 * 60;
}

function isOpenLme(date: Date): boolean {
  const z = zoned(date, "Europe/London");
  if (z.weekday === 0 || z.weekday === 6) return false;
  const mins = z.hour * 60 + z.minute;
  return mins >= 60 && mins < 19 * 60;
}

export function isSessionOpen(sessionKind: SessionKind | number, date: Date = new Date()): boolean {
  switch (sessionKind) {
    case SessionKind.CmeGlobex:
      return isOpenCmeGlobex(date);
    case SessionKind.IceUs:
      return isOpenIceUs(date);
    case SessionKind.Lme:
      return isOpenLme(date);
    default:
      return true; // Continuous, Slow, unknown
  }
}

const STEP_MS = 15 * 60_000;
const HORIZON_MS = 10 * 86_400_000;

/**
 * Next moment the calendar opens (sessions open on whole quarter hours in their zone, so a 15-minute
 * walk is exact), or null for always-open kinds / nothing within 10 days. Returns `from` if already open.
 */
export function nextSessionOpen(sessionKind: SessionKind | number, from: Date = new Date()): Date | null {
  if (isSessionOpen(sessionKind, from)) return from;
  if (sessionKind !== SessionKind.CmeGlobex && sessionKind !== SessionKind.IceUs && sessionKind !== SessionKind.Lme) return null;
  let t = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  const end = from.getTime() + HORIZON_MS;
  for (; t <= end; t += STEP_MS) if (isSessionOpen(sessionKind, new Date(t))) return new Date(t);
  return null;
}

/** "45m", "3h 20m", "1d 4h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "the session opens in 3h 20m" — or a generic phrase when the calendar can't predict it. */
export function sessionOpensCopy(sessionKind: SessionKind | number | undefined, now: Date = new Date()): string {
  if (sessionKind === undefined) return "the session reopens";
  const next = nextSessionOpen(sessionKind, now);
  if (!next) return "the session reopens";
  if (next.getTime() <= now.getTime()) return "the keeper reopens it (any moment)";
  return `the session opens in ${formatDuration(next.getTime() - now.getTime())}`;
}

/** Tooltip for the disabled Buy tab while a market is Closed. */
export function closedBuyTooltip(sessionKind: SessionKind | number | undefined, now: Date = new Date()): string {
  return `Market closed — sell-only until ${sessionOpensCopy(sessionKind, now)}`;
}
