// Theoretical option prices for the analysis screen: Black-Scholes, the
// textbook model (European exercise, no dividends). Until Interactive Brokers
// supplies real quotes every number here is an estimate, and the screen says so.
//
// Conventions: prices per share; a position's value in dollars is
// sum(side × price × qty × 100), long legs positive. P&L is that value now
// (or at a later date) less the value when it was opened, which for a plan
// is the theoretical value today.

import type { Leg, OptionPosition } from "./options";
import type { Candles } from "./candles";
import { sessions } from "./options";

export const RATE = 0.04;        // risk-free rate, a fixed estimate
export const MULT = 100;          // shares per contract
const YEAR = 365 * 86400;         // seconds; calendar-day time, as option desks quote

/** Standard normal cumulative distribution (Abramowitz and Stegun 7.1.26 via erf; error under 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const normPdf = (x: number) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);

export interface Greeks { price: number; delta: number; gamma: number; theta: number; vega: number }

/** One option, per share. `t` in years; theta per calendar day; vega per 1 volatility point. */
export function blackScholes(right: "C" | "P", s: number, k: number, t: number, vol: number, r = RATE): Greeks {
  if (t <= 0 || vol <= 0) {
    const price = Math.max(0, right === "C" ? s - k : k - s);
    const itm = right === "C" ? s > k : s < k;
    return { price, delta: itm ? (right === "C" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sq = vol * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + (vol * vol) / 2) * t) / sq;
  const d2 = d1 - sq;
  const disc = Math.exp(-r * t);
  const gamma = normPdf(d1) / (s * sq);
  const vega = (s * normPdf(d1) * Math.sqrt(t)) / 100;
  if (right === "C") {
    return {
      price: s * normCdf(d1) - k * disc * normCdf(d2), delta: normCdf(d1), gamma, vega,
      theta: (-(s * normPdf(d1) * vol) / (2 * Math.sqrt(t)) - r * k * disc * normCdf(d2)) / 365,
    };
  }
  return {
    price: k * disc * normCdf(-d2) - s * normCdf(-d1), delta: normCdf(d1) - 1, gamma, vega,
    theta: (-(s * normPdf(d1) * vol) / (2 * Math.sqrt(t)) + r * k * disc * normCdf(-d2)) / 365,
  };
}

/** Expiry is the US close, 16:00 New York, on the expiry date (approximated as 21:00 UTC; 20:00 in US summer). */
export function expiryTime(expiry: string): number {
  const d = new Date(`${expiry}T12:00:00Z`);
  const m = d.getUTCMonth();
  const summer = m > 2 && m < 10; // March to October, near enough for time left
  return Date.parse(`${expiry}T${summer ? "20" : "21"}:00:00Z`) / 1000;
}

export const yearsLeft = (expiry: string, at: number) => Math.max(0, (expiryTime(expiry) - at) / YEAR);

const sign = (l: Leg) => (l.side === "buy" ? 1 : -1);

/** The position's value and Greeks in dollars at price `s`, time `at` (seconds), volatility `vol`. */
export function positionAt(p: OptionPosition, s: number, at: number, vol: number): Greeks {
  const t = yearsLeft(p.expiry, at);
  const out = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of p.legs) {
    const g = blackScholes(l.right, s, l.strike, t, vol);
    const m = sign(l) * l.qty * MULT;
    out.price += g.price * m; out.delta += g.delta * m; out.gamma += g.gamma * m; out.theta += g.theta * m; out.vega += g.vega * m;
  }
  return out;
}

/** Value at expiry (intrinsic only), dollars. */
export const expiryValue = (p: OptionPosition, s: number) =>
  p.legs.reduce((a, l) => a + sign(l) * l.qty * MULT * Math.max(0, l.right === "C" ? s - l.strike : l.strike - s), 0);

export interface Analysis {
  spot: number;
  vol: number;
  now: number;
  entry: number;            // theoretical value now, dollars (negative = a credit received)
  credit: boolean;
  maxProfit: number | null; // at expiry; null = unlimited
  maxLoss: number | null;   // positive dollars; null = unlimited
  breakevens: number[];
  pop: number;              // probability the expiry P&L is above zero
  expectedMove: number;     // one standard deviation to expiry, in price
  greeks: Greeks;
  returnOnRisk: number | null;
}

/** Lognormal probability that the price at time t (years) ends between a and b. */
function probBetween(s: number, vol: number, t: number, a: number, b: number, r = RATE) {
  if (t <= 0) return s >= a && s <= b ? 1 : 0;
  const z = (x: number) => (x <= 0 ? -Infinity : (Math.log(x / s) - (r - (vol * vol) / 2) * t) / (vol * Math.sqrt(t)));
  const cdf = (x: number) => (x === Infinity ? 1 : x <= 0 ? 0 : normCdf(z(x)));
  return cdf(b) - cdf(a);
}

export function analyse(p: OptionPosition, spot: number, vol: number, now: number): Analysis {
  const entry = positionAt(p, spot, now, vol).price;
  const pnl = (s: number) => expiryValue(p, s) - entry;
  const strikes = [...new Set(p.legs.map((l) => l.strike))].sort((a, b) => a - b);
  const top = Math.max(...strikes) * 3;
  const points = [0, ...strikes, top];
  const netCalls = p.legs.reduce((a, l) => a + (l.right === "C" ? sign(l) * l.qty : 0), 0);
  const values = points.map(pnl);
  const maxProfit = netCalls > 0 ? null : Math.max(...values);
  const maxLoss = netCalls < 0 ? null : Math.max(0, -Math.min(...values));
  // Break-evens: where the straight pieces of the expiry line cross zero.
  const breakevens: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, x1, y0, y1] = [points[i], points[i + 1], values[i], values[i + 1]];
    if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) breakevens.push(x0 + ((0 - y0) * (x1 - x0)) / (y1 - y0));
  }
  // Probability of profit: the chance the expiry price lands where the line is above zero.
  const t = yearsLeft(p.expiry, now);
  const edges = [0, ...breakevens, Infinity];
  let pop = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i], b = edges[i + 1];
    const mid = b === Infinity ? Math.max(a * 1.5, top) : (a + b) / 2;
    if (pnl(mid) > 0) pop += probBetween(spot, vol, t, a, b);
  }
  return {
    spot, vol, now, entry, credit: entry < 0, maxProfit, maxLoss, breakevens, pop,
    expectedMove: spot * vol * Math.sqrt(t),
    greeks: positionAt(p, spot, now, vol),
    returnOnRisk: maxProfit !== null && maxLoss ? maxProfit / maxLoss : null,
  };
}

/** The P&L line across prices at time `at` (expiry when `at` is at or past it). */
export function pnlCurve(p: OptionPosition, entry: number, prices: number[], at: number, vol: number): number[] {
  const done = at >= expiryTime(p.expiry);
  return prices.map((s) => (done ? expiryValue(p, s) : positionAt(p, s, at, vol).price) - entry);
}

/** P&L if the price stays where it is, from now to expiry: time decay made visible. */
export function decayCurve(p: OptionPosition, spot: number, entry: number, vol: number, now: number, steps = 60) {
  const end = expiryTime(p.expiry);
  const out: { at: number; pnl: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const at = now + ((end - now) * i) / steps;
    out.push({ at, pnl: (i === steps ? expiryValue(p, spot) : positionAt(p, spot, at, vol).price) - entry });
  }
  return out;
}

/** Annualised volatility of daily closes over the last `days` sessions (log returns). */
export function historicalVol(c: Candles, days = 20): number | null {
  const closes = sessions(c).map((d) => d.close);
  if (closes.length < days + 1) return null;
  const rets = closes.slice(-days - 1).slice(1).map((x, i) => Math.log(x / closes[closes.length - days - 1 + i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}
