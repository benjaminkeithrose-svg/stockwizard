// The chart-page grid: cards on 12 columns, rows of fixed height. A moved or
// resized card stays where it is put, lined up to whole cells; only cards it
// lands on are pushed down out of the way. Nothing slides up on its own:
// tidy() closes the gaps when Ben asks (the Tidy button). Ben, 17 Nov 2026.

export const COLS = 12;
export const MAX_CARDS = 10;
export const MIN_W = 3;
export const MIN_H = 3;
export const NEW_W = 6;
export const NEW_H = 5;

export interface Card {
  id: string;
  workspace_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function collides(a: Card, b: Card): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Fit a card on the grid: whole numbers, at least the minimum size, inside the columns. */
export function fit(c: Card): Card {
  const w = clamp(Math.round(c.w), MIN_W, COLS);
  return { ...c, w, h: Math.max(MIN_H, Math.round(c.h)), x: clamp(Math.round(c.x), 0, COLS - w), y: Math.max(0, Math.round(c.y)) };
}

/** Reading order: top to bottom, then left to right. The phone shows cards in this order. */
export const ordered = (cards: Card[]) => [...cards].sort((a, b) => a.y - b.y || a.x - b.x);

/** Slide every card up as far as it goes without overlapping one above it. */
export function compact(cards: Card[]): Card[] {
  const placed: Card[] = [];
  for (const c of ordered(cards)) {
    let card = { ...c };
    while (card.y > 0 && !placed.some((p) => collides({ ...card, y: card.y - 1 }, p))) card = { ...card, y: card.y - 1 };
    placed.push(card);
  }
  return placed;
}

/** Put `fixed` where it is and push every card it overlaps (and those they then overlap) below it. */
function pushDown(cards: Card[], fixed: Card): Card[] {
  let out = cards.map((c) => (c.id === fixed.id ? fixed : c));
  const queue = [fixed];
  while (queue.length) {
    const mover = queue.shift()!;
    out = out.map((c) => {
      if (c.id === fixed.id || !collides(c, mover)) return c;
      const moved = { ...c, y: mover.y + mover.h };
      queue.push(moved);
      return moved;
    });
  }
  return out;
}

export function moveCard(cards: Card[], id: string, x: number, y: number): Card[] {
  const card = cards.find((c) => c.id === id);
  if (!card) return cards;
  const placed = fit({ ...card, x, y });
  return pushDown(cards, placed);
}

export function resizeCard(cards: Card[], id: string, w: number, h: number): Card[] {
  const card = cards.find((c) => c.id === id);
  if (!card) return cards;
  const sized = fit({ ...card, w, h });
  return pushDown(cards, sized);
}

/** Add a card in the first gap it fits, reading order; null if the page is full. */
export function addCard(cards: Card[], card: Omit<Card, "x" | "y" | "w" | "h">, w = NEW_W, h = NEW_H): Card[] | null {
  if (cards.length >= MAX_CARDS) return null;
  const bottom = cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const c = { ...card, x, y, w, h };
      if (!cards.some((o) => collides(c, o))) return [...cards, c];
    }
  }
  return [...cards, { ...card, x: 0, y: bottom, w, h }];
}

export function removeCard(cards: Card[], id: string): Card[] {
  return cards.filter((c) => c.id !== id);
}

/** The Tidy button: every card slides up into the gaps above it, keeping its column and size. */
export const tidy = compact;

export const rowsUsed = (cards: Card[]) => cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
