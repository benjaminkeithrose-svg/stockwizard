// "If you'd started with $5,000": the kitty card on each backtest page. The
// whole history and the held-back years (the fair test) side by side, and a
// line of the balance trade by trade, with where the held-back years begin.

import { Info } from "./parts";
import type { KittyResult } from "../data/kitty";
import Graph from "./Graph";

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function KittyCard({ all, held, splitAt, sizing }: { all: KittyResult; held: KittyResult | null; splitAt: number | null; sizing: string }) {
  const rows: [string, (k: KittyResult) => string][] = [
    ["Ending balance", (k) => money(k.end)],
    ["Profit or loss", (k) => `${signed(k.profit)} (${k.profitPct > 0 ? "+" : ""}${k.profitPct.toFixed(1)}%)`],
    ["Lowest balance", (k) => money(k.lowest)],
    ["Deepest drop from a high", (k) => `${k.deepestDropPct.toFixed(1)}%`],
    ["Trades taken", (k) => String(k.taken)],
    ["Skipped: over 2% even at one contract", (k) => String(k.skipped)],
  ];
  return (
    <>
      <h2>If you'd started with $5,000 <Info term="kitty" /></h2>
      <div className="cmptable" role="table" aria-label="The $5,000 kitty">
        <div role="row" className="head"><span role="columnheader" /><span role="columnheader">All years</span>{held && <span role="columnheader">Held-back years</span>}</div>
        {rows.map(([n, f]) => (
          <div role="row" key={n}><span role="rowheader">{n}</span><span role="cell">{f(all)}</span>{held && <span role="cell">{f(held)}</span>}</div>
        ))}
      </div>
      {all.curve.length > 2 && (
        <Graph label="The kitty's balance, trade by trade" xs={all.curve.map((c) => c.i)} height={170}
          series={[{ label: "Balance", colour: "#00287B", ys: all.curve.map((c) => c.balance), width: 1.5 }]}
          markers={splitAt ? [{ x: splitAt, label: "Held back from here", colour: "#E36C00", dashed: true, top: true }] : []}
          xFmt={(x) => `#${Math.round(x)}`} yFmt={(y) => money(y)} />
      )}
      <p className="hint">{sizing} The held-back column starts again at $5,000 on the first held-back trade.{all.wipedOut ? " The kitty fell below what a trade needed and couldn't recover." : ""}</p>
    </>
  );
}
