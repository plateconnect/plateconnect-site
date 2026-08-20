/**
 * The school's timezone. Every calendar day boundary, filter and displayed
 * timestamp is resolved in this zone rather than the viewer's browser zone,
 * so every admin sees the same days regardless of where they are.
 *
 * Change this one constant to move the whole app to another zone. Use an IANA
 * zone name (not a fixed offset like "EST") so daylight saving is handled.
 */
export const APP_TIME_ZONE = "America/New_York";

const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** Calendar date in school time as "YYYY-MM-DD" — sorts and compares lexicographically. */
export function zonedDayKey(d: Date) {
  const p = partsOf(DAY_FMT, d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock time in school time as 24h "HH:MM", matching <input type="time"> values. */
export function zonedTimeKey(d: Date) {
  const p = partsOf(TIME_FMT, d);
  return `${p.hour}:${p.minute}`;
}

/** Day key shifted by whole days. Uses UTC noon so DST transitions can't roll the date. */
export function shiftDayKey(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  noon.setUTCDate(noon.getUTCDate() + days);
  return noon.toISOString().split("T")[0];
}

/** Day of week (0 = Sunday) for a day key. */
export function dayKeyWeekday(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** Start-of-week day key (Sunday) for the school's current day. */
export function currentWeekStartKey() {
  const todayKey = zonedDayKey(new Date());
  return shiftDayKey(todayKey, -dayKeyWeekday(todayKey));
}

/** Short date in school time, e.g. "10/03/25". */
export function formatDateShort(d: Date) {
  const p = partsOf(DAY_FMT, d);
  return `${Number(p.month)}/${p.day}/${p.year.slice(-2)}`;
}

/** Short time in school time, e.g. "10:03 AM". */
export function formatTimeShort(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: APP_TIME_ZONE });
}

/** Human-readable gap between two instants, e.g. "3m", "2h 15m". */
export function formatElapsed(startMs: number, endMs: number) {
  const totalMin = Math.max(0, Math.round((endMs - startMs) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Abbreviated zone label for the current date, e.g. "EDT". */
export function currentZoneAbbreviation(at: Date = new Date()) {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  );
}

const OFFSET_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** How far the school's wall clock is behind UTC at `at`, in ms (EDT → +4h). */
function zoneOffsetMs(at: Date) {
  const p = partsOf(OFFSET_FMT, at);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return at.getTime() - asUtc;
}

/**
 * The instant a day key begins in school time — midnight, not UTC midnight.
 *
 * Needed to turn a "YYYY-MM-DD" into a Firestore range bound. Resolved in two
 * passes because the zone's offset depends on the instant you ask about, and
 * on a DST changeover the offset at UTC midnight is not the offset at local
 * midnight; the second pass re-reads it at the corrected instant.
 */
export function dayKeyStart(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instant = new Date(wall + zoneOffsetMs(new Date(wall)));
  instant = new Date(wall + zoneOffsetMs(instant));
  return instant;
}
