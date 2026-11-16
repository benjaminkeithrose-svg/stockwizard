import { describe, expect, it } from "vitest";
import { addCard, Card, collides, compact, MAX_CARDS, moveCard, ordered, removeCard, resizeCard } from "../src/data/grid";

const noOverlaps = (cards: Card[]) => cards.every((a) => cards.every((b) => !collides(a, b)));
const card = (id: string, x: number, y: number, w = 6, h = 5): Card => ({ id, workspace_id: `w-${id}`, x, y, w, h });

describe("chart page grid", () => {
  it("new cards fill the first gap, two across", () => {
    let cards: Card[] = [];
    for (const id of ["a", "b", "c"]) cards = addCard(cards, { id, workspace_id: id })!;
    expect(cards.map((c) => [c.id, c.x, c.y])).toEqual([["a", 0, 0], ["b", 6, 0], ["c", 0, 5]]);
  });

  it("stops at 10 cards", () => {
    let cards: Card[] = [];
    for (let i = 0; i < MAX_CARDS; i++) cards = addCard(cards, { id: `c${i}`, workspace_id: `w${i}` })!;
    expect(cards).toHaveLength(10);
    expect(addCard(cards, { id: "x", workspace_id: "x" })).toBeNull();
    expect(noOverlaps(cards)).toBe(true);
  });

  it("a card dropped on another pushes it down, then everything closes up", () => {
    const cards = [card("a", 0, 0), card("b", 6, 0), card("c", 0, 5)];
    const out = moveCard(cards, "c", 6, 0); // drop c onto b's spot
    expect(noOverlaps(out)).toBe(true);
    const at = Object.fromEntries(out.map((c) => [c.id, [c.x, c.y]]));
    expect(at.c).toEqual([6, 0]);
    expect(at.b).toEqual([6, 5]);
    expect(at.a).toEqual([0, 0]);
  });

  it("snaps to whole cells and stays inside the columns", () => {
    const out = moveCard([card("a", 0, 0)], "a", 9.6, 2.4);
    expect(out[0]).toMatchObject({ x: 6, y: 0 }); // 6 wide can go no further right than column 6; slides up
  });

  it("resizing pushes neighbours below and respects the minimum size", () => {
    const cards = [card("a", 0, 0), card("b", 0, 5)];
    const big = resizeCard(cards, "a", 12, 8);
    expect(noOverlaps(big)).toBe(true);
    expect(big.find((c) => c.id === "b")!.y).toBe(8);
    const tiny = resizeCard(cards, "a", 1, 1);
    expect(tiny.find((c) => c.id === "a")).toMatchObject({ w: 3, h: 3 });
  });

  it("removing a card closes the gap", () => {
    const cards = [card("a", 0, 0, 12, 5), card("b", 0, 5, 12, 5)];
    expect(removeCard(cards, "a")[0]).toMatchObject({ id: "b", y: 0 });
  });

  it("compacting never leaves a card floating", () => {
    const out = compact([card("a", 0, 10), card("b", 6, 3)]);
    expect(out.map((c) => c.y)).toEqual([0, 0]);
  });

  it("the phone order is reading order", () => {
    const out = ordered([card("c", 0, 5), card("b", 6, 0), card("a", 0, 0)]);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
