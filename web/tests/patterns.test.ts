import { describe, expect, it } from "vitest";
import golden from "../src/data/patterns-golden.json";
import { detect, PATTERN_NAMES } from "../src/data/patterns";

describe("the browser finds exactly the patterns the Python library finds", () => {
  for (const set of golden.sets) {
    it(`on ${set.name}`, () => {
      const d = detect({ ...set.candles, time: set.time, source: "golden" });
      for (const p of PATTERN_NAMES) {
        const hits = d[p].flatMap((v, i) => (v ? [i] : []));
        expect(hits, p).toEqual((set.hits as Record<string, number[]>)[p]);
      }
    });
  }
});
