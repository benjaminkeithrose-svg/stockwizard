// The Claude function carries copies of the shared engine (tools/sync_function.py). They must match.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const FILES = ["data/candles.ts", "indicators/core.ts", "indicators/index.ts", "engine/scans.ts", "engine/backtest.ts"];

it.each(FILES)("supabase/functions/claude/lib/%s matches web/src", (f) => {
  const a = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  const b = readFileSync(new URL(`../../supabase/functions/claude/lib/${f}`, import.meta.url), "utf8");
  expect(b, "run python3 tools/sync_function.py").toBe(a);
});
