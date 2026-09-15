import { DateTime } from "luxon";
import { zone } from "@/lib/time";

/** The day labels the week grid draws in its header. */

export function dayLabel(date: string): { num: string; dow: string } {
  const dt = DateTime.fromISO(date, { zone: zone() });
  return { num: dt.toFormat("d"), dow: dt.toFormat("ccc") };
}
