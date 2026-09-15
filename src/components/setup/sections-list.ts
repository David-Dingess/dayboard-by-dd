/**
 * The guide's sections, in order. A plain module with no "use client" so the
 * server page can read it (to open a `?setup=` link) and the client store can
 * too — a client module's exports cannot be called from a Server Component.
 */

export const SECTIONS = [
  "welcome",
  "look",
  "location",
  "calendars",
  "birthdays",
  "sports",
  "discord",
  "youtube",
  "twitch",
  "mail",
  "amazon",
  "computer",
  "claude",
  "music",
  "nudges",
  "transit",
  "streamdeck",
  "finish",
] as const;

export type SectionId = (typeof SECTIONS)[number];

export function isSection(value: string | null | undefined): value is SectionId {
  return (SECTIONS as readonly string[]).includes(value ?? "");
}
