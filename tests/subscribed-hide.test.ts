import { describe, expect, it } from "vitest";
import { hideRules, isHidden } from "../src/lib/subscribed";

/**
 * A typical set of work-calendar hide rules, pinned against titles of the kind
 * that appear in a shared Exchange feed. What matters is the edge: a standing
 * hold goes, but a lunch or an email task with a person or a subject attached is
 * a real entry and stays.
 */

const rules = hideRules({
  calendars: {
    Work: {
      hide: [
        "^breakfast$",
        "^lunch$",
        "^(?:emails?|scheduling|catch[ -]?up|and|[+/&])(?:\\s*(?:emails?|scheduling|catch[ -]?up|and|[+/&]))*$",
        "^expense reviews\\b",
        "^review scheduling folders$",
      ],
    },
  },
});
const work = rules.get("work");

describe("work calendar hide rules", () => {
  it.each([
    "Breakfast",
    "Lunch",
    "Email + Scheduling Catch-Up",
    "Email Catch-Up",
    "Email / Scheduling Catch-Up",
    "Email + Scheduling Catchup",
    "Email and Scheduling Catch-Up",
    "Scheduling and Email Catch-Up",
    "Email Catch-up / Scheduling",
    "Scheduling Catch Up",
    "Email / Scheduling",
    "Scheduling",
    "Expense Reviews (50/day)",
    "Review Scheduling Folders",
    "  lunch  ",
  ])("hides %j", (title) => {
    expect(isHidden(title, work)).toBe(true);
  });

  it.each([
    "Lunch w/ Candidate",
    "Team Lunch: Someone",
    "Breakfast at a hotel",
    "Scheduling for Acme",
    "Email + Scheduling Catch Up, CR",
    "Draft Progress Report Email",
    "Blog Post Graphic Work",
    "Macro Reviews + Input",
  ])("keeps %j", (title) => {
    expect(isHidden(title, work)).toBe(false);
  });

  it("matches the label case-insensitively and leaves other calendars alone", () => {
    expect(rules.has("work")).toBe(true);
    expect(isHidden("Lunch", rules.get("personal"))).toBe(false);
  });

  it("skips a broken pattern instead of throwing", () => {
    const broken = hideRules({ calendars: { X: { hide: ["(", "^ok$"] } } }).get("x");
    expect(broken).toHaveLength(1);
    expect(isHidden("ok", broken)).toBe(true);
  });
});
