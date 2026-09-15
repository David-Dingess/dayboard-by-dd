import { describe, expect, it } from "vitest";
import { applyText, emptyNotes } from "../src/lib/notes";
import { NotesFileSchema } from "../src/lib/schema";

/**
 * The notepad. Two rules worth pinning: an unchanged save does not restamp the
 * file, and whitespace is content.
 */

const T0 = "2026-09-07T21:00:00.000Z";
const T1 = "2026-09-07T21:05:00.000Z";

describe("applyText", () => {
  it("writes the text and stamps it", () => {
    const next = applyText(emptyNotes(), "call the vet", T0);
    expect(next.text).toBe("call the vet");
    expect(next.updatedAt).toBe(T0);
  });

  it("leaves the file completely alone when nothing changed", () => {
    // The editor flushes on the timer, on blur AND on losing visibility, so the
    // same text arrives several times over. Each one would otherwise claim to be
    // a save, and the status line would say "saved just now" about nothing.
    const first = applyText(emptyNotes(), "call the vet", T0);
    const again = applyText(first, "call the vet", T1);
    expect(again).toBe(first);
    expect(again.updatedAt).toBe(T0);
  });

  it("keeps trailing whitespace — in a scratch pad that is where the next line goes", () => {
    const next = applyText(emptyNotes(), "a thought\n\n", T0);
    expect(next.text).toBe("a thought\n\n");
  });
});

describe("the file", () => {
  it("fills every field, so an empty file still parses", () => {
    expect(NotesFileSchema.parse({})).toEqual({ schemaVersion: 1, text: "", updatedAt: "" });
  });

  it("refuses more than a browser should be able to write in one go", () => {
    expect(NotesFileSchema.safeParse({ text: "x".repeat(50_001) }).success).toBe(false);
    expect(NotesFileSchema.safeParse({ text: "x".repeat(50_000) }).success).toBe(true);
  });
});
