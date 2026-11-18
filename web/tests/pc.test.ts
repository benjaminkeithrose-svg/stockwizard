import { describe, expect, it } from "vitest";
import { setJob, viewFromUrl } from "../src/data/pc";

describe("screens on the PC", () => {
  it("gives each monitor one job, with one main chart at most", () => {
    let s = setJob({}, 0, "main");
    s = setJob(s, 1, "watch");
    expect(s).toEqual({ 0: "main", 1: "watch" });
    expect(setJob(s, 2, "main")).toEqual({ 1: "watch", 2: "main" });
    expect(setJob(s, 1, null)).toEqual({ 0: "main" });
    expect(setJob(s, 1, "trading")).toEqual({ 0: "main", 1: "trading" });
  });
  it("a window opened for a job knows it from its address", () => {
    expect(viewFromUrl("?view=watch")).toBe("watch");
    expect(viewFromUrl("?demo&view=trading")).toBe("trading");
    expect(viewFromUrl("?view=nonsense")).toBeNull();
    expect(viewFromUrl("")).toBeNull();
  });
});
