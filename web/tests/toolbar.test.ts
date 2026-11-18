import { describe, expect, it } from "vitest";
import { clampPlace, DEFAULT_PLACE, nextPlace } from "../src/data/toolbar";

describe("where the chart toolbar sits", () => {
  it("hiding remembers where it was, and showing goes back there", () => {
    const floating = nextPlace(DEFAULT_PLACE, "float");
    const hidden = nextPlace(floating, "hidden");
    expect(hidden.mode).toBe("hidden");
    expect(hidden.back).toBe("float");
    expect(nextPlace(hidden, "hidden").back).toBe("float");
    expect(nextPlace(hidden, hidden.back).mode).toBe("float");
  });
  it("a floating toolbar can't be dragged off the window", () => {
    const win = { w: 1000, h: 700 };
    expect(clampPlace(5000, 5000, win)).toEqual({ x: 940, y: 640 });
    expect(clampPlace(-5000, -50, win)).toEqual({ x: -240, y: 0 });
    expect(clampPlace(200, 300, win)).toEqual({ x: 200, y: 300 });
  });
});
