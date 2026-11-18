// A bot's paper trades on its symbol's chart: open positions as leg lines in
// the bot colour, an arrow where each trade opened and a dot with its profit or
// loss where it closed.

import type { ChartMarker } from "../chart/Chart";
import type { PaperOrder } from "./model";
import type { OptionPosition, Structure } from "./options";

const BOT = "#0E7C86", WIN = "#237F35", LOSS = "#C62828";
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const money = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`;

export function botsOnChart(orders: PaperOrder[], labels: Record<string, string>, symbol: string): { positions: OptionPosition[]; markers: ChartMarker[] } {
  const mine = orders.filter((o) => o.strategy_id && o.symbol === symbol);
  const positions: OptionPosition[] = mine.filter((o) => o.status === "sent" || o.status === "filled").map((o) => ({
    id: `bot-${o.id}`, symbol: o.symbol, structure: (({ bull_call_debit: "bull_call", bear_put_debit: "bear_put" } as Record<string, string>)[o.structure] ?? o.structure) as Structure, expiry: String(o.expiry).slice(0, 10),
    legs: o.legs.map((l) => ({ right: l.right, side: l.side, strike: Number(l.strike), qty: l.qty ?? 1 })), status: "bot", note: labels[o.strategy_id!] ?? "an automated strategy",
  }));
  const markers: ChartMarker[] = [];
  for (const o of mine) {
    if (!["filled", "closed"].includes(o.status)) continue;
    markers.push({ time: secs(o.created_at), text: "Auto in", color: BOT, position: "belowBar", shape: "arrowUp" });
    if (o.status === "closed" && typeof o.pnl === "number" && o.updated_at) {
      markers.push({ time: secs(o.updated_at), text: money(o.pnl), color: o.pnl >= 0 ? WIN : LOSS, position: "aboveBar", shape: "circle" });
    }
  }
  return { positions, markers };
}
