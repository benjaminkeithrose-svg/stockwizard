// The Trading screen's numbers (Ben, 19 Nov 2026): orders sorted the way a broker's
// screen sorts them, results from closed trades, which symbols automated trading touches,
// and an open position's theoretical value now. Pure: no network, so it's tested directly.

import type { BotStrategy, PaperOrder } from "./model";
import type { OptionPosition } from "./options";
import { MULT, positionAt } from "./pricing";

export type OrderTab = "working" | "filled" | "closed" | "nottraded";

/** A filled position whose close has been sent but not filled yet. */
export const closing = (o: PaperOrder) => o.status === "filled" && !!o.close_broker_id && o.close_price == null;

/** Which tab an order belongs in. A position being closed shows under Working (the close) as well as Filled. */
export function tabsOf(o: PaperOrder): OrderTab[] {
  if (["proposed", "approved", "sent"].includes(o.status)) return ["working"];
  if (o.status === "filled") return closing(o) ? ["working", "filled"] : ["filled"];
  if (o.status === "closed") return ["closed"];
  return ["nottraded"];   // refused, rejected, cancelled, failed
}

export function byTab(orders: PaperOrder[]): Record<OrderTab, PaperOrder[]> {
  const out: Record<OrderTab, PaperOrder[]> = { working: [], filled: [], closed: [], nottraded: [] };
  for (const o of orders) for (const t of tabsOf(o)) out[t].push(o);
  return out;
}

/** When a closed trade finished: its last update. */
export const closedAt = (o: PaperOrder) => o.updated_at ?? o.created_at;

export interface Results {
  trades: number;
  total: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  best: number | null;
  worst: number | null;
  /** The running total after each closed trade, oldest first: [time ms, total]. */
  curve: [number, number][];
  byStrategy: { id: string | null; label: string; trades: number; total: number; winRate: number | null }[];
}

export function results(orders: PaperOrder[], labels: Record<string, string>): Results {
  const closed = orders.filter((o) => o.status === "closed" && typeof o.pnl === "number")
    .sort((a, b) => Date.parse(closedAt(a)) - Date.parse(closedAt(b)));
  const pnl = closed.map((o) => o.pnl as number);
  const wins = pnl.filter((p) => p > 0), losses = pnl.filter((p) => p <= 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  let run = 0;
  const curve = closed.map((o): [number, number] => [Date.parse(closedAt(o)), (run += o.pnl as number)]);
  const groups = new Map<string | null, number[]>();
  for (const o of closed) groups.set(o.strategy_id ?? null, [...(groups.get(o.strategy_id ?? null) ?? []), o.pnl as number]);
  return {
    trades: closed.length,
    total: run,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    avgWin: avg(wins),
    avgLoss: avg(losses),
    best: pnl.length ? Math.max(...pnl) : null,
    worst: pnl.length ? Math.min(...pnl) : null,
    curve,
    byStrategy: [...groups.entries()].map(([id, xs]) => ({
      id, label: id ? labels[id] ?? "An automated strategy" : "From the chart (by hand)", trades: xs.length,
      total: xs.reduce((a, b) => a + b, 0), winRate: (xs.filter((p) => p > 0).length / xs.length) * 100,
    })).sort((a, b) => b.trades - a.trades),
  };
}

/** Symbols automated trading touches: those of strategies switched on, and of every position open or working. */
export function autoSymbols(strategies: BotStrategy[], orders: PaperOrder[]): Set<string> {
  const out = new Set<string>();
  for (const s of strategies) if (s.enabled) out.add(s.config.instrument);
  for (const o of orders) if (tabsOf(o).some((t) => t === "working" || t === "filled")) out.add(o.symbol);
  return out;
}

/** Cash received to open, per contract, in dollars: positive for a credit, negative for a debit. */
export const openCash = (o: PaperOrder) => (o.price_kind === "credit" ? 1 : -1) * (o.fill_price ?? o.limit_price) * MULT;

/** An open position's theoretical value now and its profit or loss so far, for the whole quantity (estimates: Black-Scholes). */
export function openValue(o: PaperOrder, spot: number, vol: number, nowMs: number): { value: number; pnl: number } {
  const p = { legs: o.legs, expiry: o.expiry } as unknown as OptionPosition;
  const value = positionAt(p, spot, nowMs / 1000, vol).price;   // what closing it would bring in, per contract (negative: it costs)
  return { value: value * o.quantity, pnl: (openCash(o) + value) * o.quantity };
}
