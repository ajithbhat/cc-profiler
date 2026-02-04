import { describe, expect, it } from "vitest";

import { parseDurationToMs } from "../src/util/duration";

describe("parseDurationToMs", () => {
  it("parses ms, s, m", () => {
    expect(parseDurationToMs("150")).toBe(150);
    expect(parseDurationToMs("150ms")).toBe(150);
    expect(parseDurationToMs("2s")).toBe(2000);
    expect(parseDurationToMs("1m")).toBe(60_000);
  });
});

