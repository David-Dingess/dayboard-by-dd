import { describe, expect, it } from "vitest";
import { readAqi, readPollen, readUv } from "../src/lib/air";

/**
 * The bands are published ones — US EPA for air quality, the standard
 * pollen.com 0-12 index, WHO for UV — so what is worth pinning is the
 * BOUNDARIES, which are the only part anyone gets wrong.
 */

describe("air quality", () => {
  it("is quiet until it matters, then says what to do", () => {
    expect(readAqi(38)!.level).toBe("ok");
    expect(readAqi(100)!.level).toBe("ok");
    expect(readAqi(101)!.level).toBe("watch");
    expect(readAqi(151)!.level).toBe("bad");
  });

  it("draws nothing at all when the provider said nothing", () => {
    // A missing reading is not a good reading. The row hides instead.
    expect(readAqi(null)).toBeNull();
    expect(readAqi(undefined)).toBeNull();
  });
});

describe("pollen", () => {
  it("uses pollen.com's own bands, which are the ones the number means", () => {
    // 0-12. The boundaries are theirs; the wording is ours.
    expect(readPollen(2.4)!.value).toBe("low");
    expect(readPollen(2.5)!.value).toBe("low-med");
    expect(readPollen(4.9)!.value).toBe("medium");
    expect(readPollen(7.3)!.value).toBe("med-high");
    expect(readPollen(9.7)!.value).toBe("high");
  });

  it("names what is actually in the air", () => {
    // "Take the antihistamine" is advice; "Ragweed, grasses" is a reason.
    expect(readPollen(6, ["Ragweed", "Grasses"])!.advice).toContain("Ragweed, grasses");
  });

  it("names two culprits at most, because three is a list", () => {
    const advice = readPollen(9.2, ["Ragweed", "Chenopods", "Grasses"])!.advice;
    expect(advice).toContain("Ragweed, chenopods");
    expect(advice).not.toContain("grasses");
  });

  it("says only the band when nothing was named", () => {
    expect(readPollen(6)!.advice).toBe("Take the antihistamine.");
  });

  it("draws nothing when the provider said nothing", () => {
    // pollen.com is unofficial. When it goes away the tile goes away.
    expect(readPollen(null)).toBeNull();
    expect(readPollen(undefined)).toBeNull();
  });
});

describe("UV", () => {
  it("asks for nothing below 3", () => {
    expect(readUv(2.9)!.level).toBe("ok");
    expect(readUv(2.9)!.advice).toContain("No need");
  });

  it("escalates through sunscreen to cover up", () => {
    expect(readUv(6)!.level).toBe("watch");
    expect(readUv(8)!.level).toBe("bad");
    expect(readUv(11)!.advice).toContain("Burns");
  });
});
