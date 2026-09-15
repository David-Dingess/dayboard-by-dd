/**
 * A face and a colour for each holiday.
 *
 * The holidays feed is one calendar, so without this every entry from New
 * Year's Day to Tax Day renders as the same grey 📅. Matching is first-hit on an
 * ordered list, so the specific patterns ("New Year's Eve") must come before the
 * general ones ("New Year").
 *
 * Colours are picked to read on the dark ground and to be recognisable at a
 * glance — Halloween orange, Christmas green, Valentine's red.
 */

export interface HolidayStyle {
  emoji: string;
  color: string;
}

const RULES: [RegExp, string, string][] = [
  // --- the big seasonal ones -------------------------------------------------
  [/halloween/i, "🎃", "#ff7518"],
  [/christmas eve/i, "🕯️", "#2e8b57"],
  [/christmas/i, "🎄", "#2e8b57"],
  [/new year'?s eve/i, "🥂", "#e8c05a"],
  [/new year'?s day|^new year/i, "🎉", "#e8c05a"],
  [/thanksgiving/i, "🦃", "#d98d3a"],
  [/independence day|fourth of july|4th of july/i, "🎆", "#d7263d"],
  [/valentine/i, "❤️", "#e0507a"],
  [/st\.? patrick/i, "☘️", "#2ea44f"],
  [/easter/i, "🐣", "#c58fd4"],
  [/mother'?s day/i, "💐", "#ea94b8"],
  [/father'?s day/i, "👔", "#6aa9d9"],
  [/cinco de mayo/i, "🌮", "#3aa655"],

  // --- days off work ---------------------------------------------------------
  [/martin luther king|mlk/i, "✊", "#8f6fc0"],
  [/presidents'? day|washington'?s birthday/i, "🎩", "#4a6fa5"],
  [/memorial day/i, "🇺🇸", "#c8102e"],
  [/juneteenth/i, "🎊", "#d7263d"],
  [/labor day/i, "🛠️", "#5b8f6a"],
  [/indigenous peoples/i, "🪶", "#c98a5e"],
  [/columbus day/i, "⛵", "#7ea0f0"],
  [/veterans day/i, "🎖️", "#4a6fa5"],
  [/patriot day|september 11/i, "🕯️", "#9aa3ad"],

  // --- observances -----------------------------------------------------------
  [/election day/i, "🗳️", "#4a6fa5"],
  [/black friday/i, "🛍️", "#b0b7c3"],
  [/tax day/i, "🧾", "#9aa3ad"],
  [/groundhog/i, "🐿️", "#a1887f"],
  [/super bowl/i, "🏈", "#8a5a44"],
  [/earth day/i, "🌍", "#4fbf6a"],
  [/flag day/i, "🚩", "#c8102e"],
  [/april fool/i, "🃏", "#c58fd4"],
  [/pi day/i, "🥧", "#d98d3a"],
  [/daylight saving/i, "🕐", "#9aa3ad"],

  // --- faith and culture -----------------------------------------------------
  [/hanukkah|chanukah/i, "🕎", "#5b8fd6"],
  [/kwanzaa/i, "🕯️", "#2f8f4f"],
  [/rosh hashanah|yom kippur|passover|sukkot|purim/i, "🕍", "#5b8fd6"],
  [/ramadan|eid/i, "🌙", "#3aa6a0"],
  [/diwali/i, "🪔", "#e8a13a"],
  [/lunar new year|chinese new year/i, "🧧", "#d7263d"],
  [/holi\b/i, "🎨", "#e0507a"],
  [/ash wednesday|good friday|palm sunday|lent/i, "✝️", "#8f6fc0"],
  [/cesar chavez/i, "🌾", "#5b8f6a"],
  [/juvenile|kids? day|children'?s day/i, "🧒", "#f5924f"],

  // --- seasons ---------------------------------------------------------------
  [/first day of spring|vernal equinox/i, "🌸", "#ea94b8"],
  [/first day of summer|summer solstice/i, "☀️", "#e8c05a"],
  [/first day of (autumn|fall)|autumnal equinox/i, "🍂", "#d98d3a"],
  [/first day of winter|winter solstice/i, "❄️", "#7fb2e5"],
];

/** Anything with no rule of its own — still better than a bare calendar page. */
const DEFAULT: HolidayStyle = { emoji: "🗓️", color: "#9aa3ad" };

export function styleForHoliday(title: string): HolidayStyle {
  for (const [pattern, emoji, color] of RULES) {
    if (pattern.test(title)) return { emoji, color };
  }
  return DEFAULT;
}

/** Does this subscribed calendar look like a holiday feed? */
export function isHolidayCalendar(label: string): boolean {
  return /holiday/i.test(label);
}
