// Calls and puts placed on the chart: the structures, where a new one goes,
// and moving it. Plans only: nothing here prices an option or sends an order.
//
// Default placement (Ben, 17 Nov 2026, "one daily range out"): the short
// strikes sit one average daily range (ATR 14 of daily candles) either side of
// the latest session's mean price; wings $5 beyond. Strikes snap to the
// symbol's strike step. The person then drags it where they want it.

import type { Candles } from "./candles";
import { nyParts } from "./candles";
import { newId } from "./model";

export type Right = "C" | "P";
export type Side = "buy" | "sell";
export interface Leg { right: Right; side: Side; strike: number; qty: number }

export type Structure = "iron_condor" | "iron_fly" | "bull_call" | "bear_put" | "bull_put" | "bear_call" | "call" | "put";

export interface OptionPosition {
  id: string;
  symbol: string;
  structure: Structure;
  expiry: string;            // YYYY-MM-DD
  legs: Leg[];
  status: "planned" | "bought" | "closed" | "bot";   // "bot": a bot's open paper position, drawn on the chart only
  note: string | null;
  updated_at?: string;
}

export const STRUCTURES: { id: Structure; label: string; what: string }[] = [
  { id: "iron_condor", label: "Iron condor", what: "Sell a put and a call one daily range out; buy wings beyond" },
  { id: "iron_fly", label: "Iron fly", what: "Sell a put and a call at the mean; buy wings either side" },
  { id: "bull_put", label: "Bull put (credit)", what: "Sell a put one daily range below; buy one beyond" },
  { id: "bear_call", label: "Bear call (credit)", what: "Sell a call one daily range above; buy one beyond" },
  { id: "bull_call", label: "Bull call (debit)", what: "Buy a call at the mean; sell one a daily range above" },
  { id: "bear_put", label: "Bear put (debit)", what: "Buy a put at the mean; sell one a daily range below" },
  { id: "call", label: "Call", what: "Buy a call at the mean" },
  { id: "put", label: "Put", what: "Buy a put at the mean" },
];
export const structureLabel = (s: Structure) => STRUCTURES.find((x) => x.id === s)?.label ?? s;

export const WING = 5;

/** The strike step: $1 for most US stocks and ETFs (SPY), 50c under $25. */
export const strikeStep = (price: number) => (price < 25 ? 0.5 : 1);
export const snap = (price: number, step: number) => Math.round(price / step) * step;

/** Daily high, low and close per New York trading date, from candles of any timeframe. */
export function sessions(c: Candles) {
  const out: { date: string; high: number; low: number; close: number; sumTypical: number; n: number }[] = [];
  for (let i = 0; i < c.time.length; i++) {
    const date = nyParts(c.time[i]).date;
    const last = out[out.length - 1];
    const typical = (c.high[i] + c.low[i] + c.close[i]) / 3;
    if (!last || last.date !== date) out.push({ date, high: c.high[i], low: c.low[i], close: c.close[i], sumTypical: typical, n: 1 });
    else {
      last.high = Math.max(last.high, c.high[i]);
      last.low = Math.min(last.low, c.low[i]);
      last.close = c.close[i];
      last.sumTypical += typical;
      last.n++;
    }
  }
  return out;
}

/** The latest session's mean price and the daily ATR(14) (Wilder's), from the chart's candles. */
export function placementBasis(c: Candles, length = 14): { mean: number; atr: number; date: string } | null {
  const s = sessions(c);
  if (!s.length) return null;
  const tr = s.map((d, i) => (i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - s[i - 1].close), Math.abs(d.low - s[i - 1].close))));
  let atr: number;
  if (tr.length < length) atr = tr.reduce((a, b) => a + b, 0) / tr.length;
  else {
    atr = tr.slice(0, length).reduce((a, b) => a + b, 0) / length;
    for (let i = length; i < tr.length; i++) atr = (atr * (length - 1) + tr[i]) / length;
  }
  const last = s[s.length - 1];
  return { mean: last.sumTypical / last.n, atr, date: last.date };
}

/** A new structure's legs around `mean`, `atr` out, wings `wing` beyond. */
export function defaultLegs(structure: Structure, mean: number, atr: number, wing = WING): Leg[] {
  const step = strikeStep(mean);
  const at = snap(mean, step);
  const range = Math.max(step, snap(atr, step));
  const w = Math.max(step, snap(wing, step));
  const L = (right: Right, side: Side, strike: number): Leg => ({ right, side, strike, qty: 1 });
  switch (structure) {
    case "iron_condor":
      return [L("P", "buy", at - range - w), L("P", "sell", at - range), L("C", "sell", at + range), L("C", "buy", at + range + w)];
    case "iron_fly":
      return [L("P", "buy", at - w), L("P", "sell", at), L("C", "sell", at), L("C", "buy", at + w)];
    case "bull_put":
      return [L("P", "buy", at - range - w), L("P", "sell", at - range)];
    case "bear_call":
      return [L("C", "sell", at + range), L("C", "buy", at + range + w)];
    case "bull_call":
      return [L("C", "buy", at), L("C", "sell", at + range)];
    case "bear_put":
      return [L("P", "sell", at - range), L("P", "buy", at)];
    case "call":
      return [L("C", "buy", at)];
    case "put":
      return [L("P", "buy", at)];
  }
}

/** Weekdays from `from` (YYYY-MM-DD, included when it is a weekday) for `days` weekdays. Exchange holidays aren't known yet: check at the broker. */
export function expiryChoices(from: string, days = 15): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  while (out.length < days) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Calendar days from `today` to `expiry` (0 = expires today). */
export function daysToExpiry(expiry: string, today: string) {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export const todayNY = () => nyParts(Math.floor(Date.now() / 1000)).date;

export function newPosition(symbol: string, structure: Structure, basis: { mean: number; atr: number }, expiry: string): OptionPosition {
  return { id: newId(), symbol, structure, expiry, legs: defaultLegs(structure, basis.mean, basis.atr), status: "planned", note: null };
}

export type MoveMode = "whole" | "side" | "leg";

/**
 * Move leg `i` to `strike` (snapped). "whole" moves every leg by the same amount;
 * "side" moves the legs of the same right (the put side or the call side of a
 * condor) together; "leg" moves that leg alone.
 */
export function moveLeg(p: OptionPosition, i: number, strike: number, mode: MoveMode): OptionPosition {
  const step = strikeStep(p.legs[i].strike);
  const delta = snap(strike, step) - p.legs[i].strike;
  if (!delta) return p;
  const legs = p.legs.map((l, j) => {
    const moves = mode === "whole" || j === i || (mode === "side" && l.right === p.legs[i].right);
    return moves ? { ...l, strike: Math.max(step, l.strike + delta) } : l;
  });
  return { ...p, legs };
}

/** Problems worth flagging: crossed legs (a short call below the short put), a wing on the wrong side. */
export function problems(p: OptionPosition): string[] {
  const out: string[] = [];
  const sp = p.legs.find((l) => l.right === "P" && l.side === "sell");
  const sc = p.legs.find((l) => l.right === "C" && l.side === "sell");
  const bp = p.legs.find((l) => l.right === "P" && l.side === "buy");
  const bc = p.legs.find((l) => l.right === "C" && l.side === "buy");
  if (sp && sc && sp.strike > sc.strike) out.push("The short put is above the short call.");
  if (["iron_condor", "iron_fly", "bull_put"].includes(p.structure) && sp && bp && bp.strike >= sp.strike) out.push("The put wing should be below the short put.");
  if (["iron_condor", "iron_fly", "bear_call"].includes(p.structure) && sc && bc && bc.strike <= sc.strike) out.push("The call wing should be above the short call.");
  return out;
}

/** The most this plan can lose at expiry, per contract set, in dollars (100 shares a contract), when the risk is defined. Ignores the premium, which isn't known yet. */
export function widestWing(p: OptionPosition): number | null {
  const width = (r: Right) => {
    const s = p.legs.find((l) => l.right === r && l.side === "sell"), b = p.legs.find((l) => l.right === r && l.side === "buy");
    return s && b ? Math.abs(s.strike - b.strike) : null;
  };
  const sells = p.legs.filter((l) => l.side === "sell");
  if (!sells.length) return null; // bought options: the risk is what was paid
  const w = [width("P"), width("C")];
  if (sells.some((l) => width(l.right) === null)) return null; // a naked short: undefined risk
  return Math.max(...w.filter((x): x is number => x !== null)) * 100;
}

export const legName = (l: Leg) => `${l.side === "sell" ? "Short" : "Long"} ${l.right === "C" ? "call" : "put"} ${l.strike}`;

const dayFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
export const expiryLabel = (e: string) => dayFmt.format(new Date(`${e}T00:00:00Z`));
