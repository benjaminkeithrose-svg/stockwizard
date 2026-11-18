// Bots made from backtests (Ben, 18 Nov 2026). "Make a bot" on a backtest page
// maps that test's settings to the bot's (a strategy_runner Config) and keeps
// where it came from. A bot whose settings still equal the ones it was made
// with counts as tested and can be switched on; change one and it is untested
// until backtested again. What the bot can't run says why instead.

import type { BotSource, BotStrategy, OptionRun, OptionStrategyDef, PaperOrder, ResearchStrategy, StrategyConfig } from "./model";

export type BotDraft = { ok: true; bot: BotStrategy } | { ok: false; why: string };

const MANAGE: Record<string, Partial<StrategyConfig>> = {
  expiry: {},
  take_50: { profit_target: 0.5 },
  close_21: { close_days_left: 21 },
  stop_2x: { stop_mult: 2 },
};

const BOT_STRUCTURES = ["iron_condor", "iron_fly", "bull_put", "bear_call", "bull_call_debit", "bear_put_debit"];

/** An option backtest (Backtests, Options) as a bot: SPY, the same structure, expiry, placement, wings and management. */
export function botFromOptionBacktest(def: OptionStrategyDef, run: OptionRun | undefined): BotDraft {
  const c = def.config as OptionStrategyDef["config"] & { intraday?: boolean; signal_params?: Record<string, unknown>; vix_min?: number | null };
  if (c.intraday) return { ok: false, why: "Same-day methods are tested on hourly candles, which automated trading doesn't use. The 0DTE research survivors can be automated." };
  if (!BOT_STRUCTURES.includes(c.structure)) return { ok: false, why: "Automated trading can't place call or put condors yet. The iron condor on the same strikes has the same payoff and can be automated." };
  if (!(c.manage in MANAGE)) return { ok: false, why: `Automated trading doesn't manage trades this way (${c.manage}) yet.` };
  if (!run) return { ok: false, why: "This backtest hasn't been run yet." };
  const config: StrategyConfig = {
    instrument: "SPY", structure: c.structure, entry: "10:00", short_delta: 0.15, width: c.wing, dte: c.dte,
    ...(c.structure === "iron_condor" || c.structure === "bull_put" || c.structure === "bear_call" ? { short_atr: c.short_atr ?? 1 } : {}),
    ...MANAGE[c.manage],
    ...(c.vix_max != null ? { vix_max: c.vix_max } : {}),
    ...(c.vix_min != null ? { vix_min: c.vix_min } : {}),
    ...(c.signal_rule ? { signal_rule: c.signal_rule, signal_params: c.signal_params ?? {} } : {}),
  };
  const h = run.report.held_back;
  const source: BotSource = { kind: "option", id: def.id, label: def.label, config, held_back: { trades: h.trades, win_rate: h.win_rate, expectancy: h.expectancy } };
  return { ok: true, bot: { id: "", label: def.label, config, enabled: false, source } };
}

/** A 0DTE research survivor as a bot: its configuration is already the bot's. */
export function botFromResearch(s: ResearchStrategy): BotDraft {
  if (!s.config) return { ok: false, why: "This result was saved before its settings were kept; re-run the research to automate it." };
  const raw = Object.fromEntries(Object.entries(s.config).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)));
  const config = { ...raw, dte: 0 } as StrategyConfig;
  const v = s.validation;
  const source: BotSource = { kind: "research", id: s.strategy, label: s.strategy, config,
    held_back: v ? { trades: v.trades, win_rate: v.win_rate ?? null, expectancy: v.expectancy ?? null } : null };
  return { ok: true, bot: { id: "", label: s.strategy.replace(/ · /g, " ").slice(0, 60), config, enabled: false, source } };
}

/** The settings, compared without empty values and in any key order. */
export function sameSettings(a: StrategyConfig, b: StrategyConfig): boolean {
  const norm = (c: StrategyConfig) => JSON.stringify(Object.entries(c)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && !(typeof v === "object" && v && !Array.isArray(v) && !Object.keys(v).length) && !(Array.isArray(v) && !v.length))
    .sort(([x], [y]) => x.localeCompare(y)));
  return norm(a) === norm(b);
}

/** A bot can be switched on only while its settings are the ones its backtest tested. */
export const isTested = (b: BotStrategy) => !!b.source && sameSettings(b.config, b.source.config);

/** The bot's paper results so far: closed trades, share won, average profit or loss. */
export function paperResults(orders: PaperOrder[], botId: string) {
  const closed = orders.filter((o) => o.strategy_id === botId && o.status === "closed" && typeof o.pnl === "number");
  const pnl = closed.map((o) => o.pnl as number);
  return {
    trades: closed.length,
    win_rate: closed.length ? (pnl.filter((p) => p > 0).length / closed.length) * 100 : null,
    expectancy: closed.length ? pnl.reduce((a, b) => a + b, 0) / closed.length : null,
    open: orders.filter((o) => o.strategy_id === botId && ["proposed", "sent", "filled"].includes(o.status)).length,
  };
}
