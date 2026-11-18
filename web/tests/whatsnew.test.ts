import { describe, expect, it } from "vitest";
import { APP_BUILD } from "../src/config";
import { justUpdated, WHATS_NEW } from "../src/data/whatsnew";

describe("what's new", () => {
  it("says Updated only when a different build was seen before on this device", () => {
    expect(justUpdated(null, "sw-v40")).toBe(false);
    expect(justUpdated("sw-v40", "sw-v40")).toBe(false);
    expect(justUpdated("sw-v39", "sw-v40")).toBe(true);
  });
  it("has an entry for this build, newest first", () => {
    expect(WHATS_NEW[0].build).toBe(APP_BUILD);
    const n = WHATS_NEW.map((w) => Number(w.build.replace("sw-v", "")));
    expect([...n].sort((a, b) => b - a)).toEqual(n);
  });
});
