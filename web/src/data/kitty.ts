// "If you'd started with $5,000" (Ben, 18 Nov 2026): a theoretical kitty run
// through a backtest's trades in order, each trade sized to risk 2% of the
// balance at the time.
//
// Options: as many contracts as keep the trade's worst case (its max loss) at
// or under 2% of the balance. If even one contract's worst case is over 2%,
// the trade is skipped and counted: a kitty that size can't take it.
// Stocks with a stop: a position sized so hitting the stop loses 2%. Stocks
// without a stop (the VIX index studies): a fixed 10% of the balance a trade,
// as there's no defined worst case to size from. The same rules as
// backend/stockwizard/zerodte/stats.kitty.

export const KITTY = 5000;
export const RISK = 0.02;
export const NO_STOP_SHARE = 0.10;

export interface KittyResult {
  start: number;
  end: number;
  profit: number;
  profitPct: number;
  lowest: number;
  deepestDropPct: number;     // the worst fall from a high, in %
  taken: number;
  skipped: number;            // worst case over 2% of the balance even at one contract
  wipedOut: boolean;          // fell below what the next trade needed and stayed there
  curve: { i: number; balance: number }[];
}

function finish(start: number, balances: number[], taken: number, skipped: number, wipedOut: boolean): KittyResult {
  let peak = start, deepest = 0, lowest = start;
  for (const b of balances) {
    peak = Math.max(peak, b);
    lowest = Math.min(lowest, b);
    deepest = Math.min(deepest, (b / peak - 1) * 100);
  }
  const end = balances.length ? balances[balances.length - 1] : start;
  return {
    start, end: round2(end), profit: round2(end - start), profitPct: round2((end / start - 1) * 100), lowest: round2(lowest),
    deepestDropPct: round2(deepest), taken, skipped, wipedOut, curve: [{ i: 0, balance: start }, ...balances.map((b, i) => ({ i: i + 1, balance: round2(b) }))],
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Option trades: `pnl` and `max_loss` in dollars for one structure. */
export function optionKitty(trades: { pnl: number; max_loss: number }[], start = KITTY, risk = RISK): KittyResult {
  let bal = start, taken = 0, skipped = 0, wiped = false;
  const balances: number[] = [];
  for (const t of trades) {
    if (t.max_loss <= 0) { skipped++; continue; }
    const n = Math.floor((risk * bal) / t.max_loss + 1e-9);
    if (n < 1) {
      skipped++;
      if (bal < t.max_loss) wiped = true;
      continue;
    }
    bal += n * t.pnl;
    taken++;
    balances.push(bal);
  }
  return finish(start, balances, taken, skipped, wiped && taken > 0 && bal < start);
}

/** Stock trades: `return_pct` per trade; `stopPct` the strategy's stop (null when it has none). */
export function stockKitty(trades: { return_pct: number | null }[], stopPct: number | null, start = KITTY, risk = RISK): KittyResult {
  let bal = start, taken = 0;
  const balances: number[] = [];
  for (const t of trades) {
    if (t.return_pct === null) continue;
    const position = stopPct ? Math.min(bal, (risk * bal) / (stopPct / 100)) : NO_STOP_SHARE * bal;
    bal += position * (t.return_pct / 100);
    taken++;
    balances.push(bal);
  }
  return finish(start, balances, taken, 0, false);
}
