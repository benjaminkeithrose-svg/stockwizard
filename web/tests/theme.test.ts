import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MODES, resolved } from "../src/theme";

describe("look and feel", () => {
  it("is light, dark, or whatever the device uses", () => {
    expect(MODES.map((m) => m.id)).toEqual(["light", "dark", "system"]);
    expect(resolved("light", true)).toBe("light");
    expect(resolved("dark", false)).toBe("dark");
    expect(resolved("system", true)).toBe("dark");
    expect(resolved("system", false)).toBe("light");
  });

  it("has a dark value for every colour the app is built from", () => {
    const css = readFileSync(new URL("../src/ui/app.css", import.meta.url), "utf8");
    const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
    const names = (b: string) => [...b.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
    const light = names(block(":root {"));
    const dark = new Set(names(block('[data-mode="dark"] {')));
    expect(light.filter((n) => !["--r", "--r-sm", "--r-pill"].includes(n) && !dark.has(n))).toEqual([]);
  });

  it("is stored under a stockwizard name (the web address is shared with Ben's other apps)", () => {
    const src = readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8");
    expect(src).toContain('const KEY = "stockwizard.theme"');
  });
});
