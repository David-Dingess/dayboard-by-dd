import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { birthdayId } from "./uid";
import { zone } from "./time";

/**
 * Birthdays live in data/settings.json as `{ name, month, day }` rows — no
 * year, which is why they become yearly-recurring all-day events anchored to
 * the current year rather than dated ones. They are GENERATED on every read,
 * like the health sessions: a row is the truth, an event is arithmetic.
 *
 * `parseCsv` takes the shape a Facebook export has (`Name,Month,Day,Link to
 * Profile`) and also a plain `name,month,day` list typed by hand.
 */

export function parseCsv(text: string): { name: string; month: number; day: number; url?: string }[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const idx = (want: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === want);
  const iName = idx("name");
  const iMonth = idx("month");
  const iDay = idx("day");
  const iUrl = header.findIndex((h) => h.trim().toLowerCase().includes("link"));

  const out: { name: string; month: number; day: number; url?: string }[] = [];
  for (const r of body) {
    const name = (r[iName] ?? "").trim();
    const month = Number(r[iMonth]);
    const day = Number(r[iDay]);
    if (!name || !Number.isInteger(month) || !Number.isInteger(day)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const url = iUrl >= 0 ? (r[iUrl] ?? "").trim() : "";
    out.push({ name, month, day, url: url || undefined });
  }
  return out;
}

export function birthdayEvents(
  rows: { name: string; month: number; day: number; url?: string }[],
  anchorYear: number,
): DayboardEvent[] {
  const now = new Date().toISOString();
  const events: DayboardEvent[] = [];

  for (const row of rows) {
    const date = DateTime.fromObject(
      { year: anchorYear, month: row.month, day: row.day },
      { zone: zone() },
    );
    // Feb 29 in a non-leap anchor year would silently roll to Mar 1.
    if (!date.isValid) continue;

    events.push({
      id: birthdayId(row.name),
      layer: "birthdays",
      title: `${row.name} — birthday`,
      start: date.toISODate()!,
      end: date.plus({ days: 1 }).toISODate()!,
      allDay: true,
      tz: zone(),
      url: row.url,
      source: { kind: "generated", ref: "birthdays" },
      recurrence: { freq: "YEARLY", interval: 1 },
      status: "confirmed",
      seq: 0,
      updatedAt: now,
    });
  }

  return events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
