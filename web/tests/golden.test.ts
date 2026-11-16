// The browser's indicators against the Python library's numbers (golden.json),
// plus the truncation test on the browser copy.

import { describe, expect, it } from "vitest";
import golden from "../src/indicators/golden.json";
import { compute, REGISTRY } from "../src/indicators";
import { Candles, sliceCandles, Timeframe } from "../src/data/candles";

type Frame = {
  candles: Omit<Candles, "source">;
  indicators: Record<string, { params: Record<string, string>; columns: Record<string, (number | boolean | null)[]> }>;
};
const frames = golden.frames as unknown as Record<Timeframe, Frame>;
const TOL = 1e-9;

const same = (a: number, b: number) =>
  (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));

const asNumber = (v: number | boolean | null) => (v === null ? NaN : v === true ? 1 : v === false ? 0 : v);

for (const tf of Object.keys(frames) as Timeframe[]) {
  const frame = frames[tf];
  const candles: Candles = { ...frame.candles, source: "made-up" };

  describe(`indicators on ${tf} candles`, () => {
    for (const [name, expected] of Object.entries(frame.indicators)) {
      it(`${name} matches the Python library`, () => {
        const got = compute(name, candles, tf, expected.params);
        expect(Object.keys(got).sort()).toEqual(Object.keys(expected.columns).sort());
        for (const [col, want] of Object.entries(expected.columns)) {
          const bad = want.findIndex((w, i) => !same(asNumber(w), got[col][i]));
          expect(bad, `${name}.${col} differs at candle ${bad}: ${want[bad]} vs ${got[col][bad]}`).toBe(-1);
        }
      });

      it(`${name} does not look ahead`, () => {
        const full = compute(name, candles, tf, expected.params);
        const n = candles.time.length;
        for (const k of [5, 30, Math.floor(n / 3), Math.floor(n / 2), n - 7, n - 1]) {
          const cut = compute(name, sliceCandles(candles, k), tf, expected.params);
          for (const col of Object.keys(full)) {
            const bad = cut[col].findIndex((v, i) => !same(v, full[col][i]));
            expect(bad, `${name}.${col} changed at ${bad} when cut at ${k}`).toBe(-1);
          }
        }
      });
    }
  });
}

it("every registered indicator is in the reference file", () => {
  const covered = new Set([...Object.keys(frames["5m"].indicators), ...Object.keys(frames["1d"].indicators)]);
  expect([...covered].sort()).toEqual(Object.keys(REGISTRY).sort());
});

it("names, versions and default settings match the Python registry", () => {
  const py = golden.registry as Record<string, { version: number; defaults: Record<string, unknown>; intraday_only: boolean }>;
  expect(Object.keys(REGISTRY).sort()).toEqual(Object.keys(py).sort());
  for (const [name, def] of Object.entries(REGISTRY)) {
    expect(def.version, name).toBe(py[name].version);
    expect(def.intradayOnly, name).toBe(py[name].intraday_only);
    const pyDefaults = Object.fromEntries(Object.entries(py[name].defaults).map(([k, v]) => [k, v ?? ""]));
    expect(def.defaults, name).toEqual(pyDefaults);
  }
});
