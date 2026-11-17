import { describe, expect, it } from "vitest";
import { botFromOptionBacktest, botFromResearch, isTested, paperResults } from "../src/data/bots";
import { botsOnChart } from "../src/data/botsOnChart";
import type { OptionRun, OptionStrategyDef, PaperOrder } from "../src/data/model";

const m = (trades: number, win_rate: number, expectancy: number) => ({ trades, win_rate, expectancy } as unknown as OptionRun["report"]["held_back"]);
const run = { report: { build: m(100, 70, 20), held_back: m(40, 65, 12) } } as OptionRun;
const def = (config: Record<string, unknown>): OptionStrategyDef =>
  ({ id: "x", label: "X", family: "spy_monthly", config, start_date: "2006-01-02", split_date: "2021-11-17", position: 0, notes: null }) as OptionStrategyDef;

describe("Make a bot from a backtest", () => {
  it("maps an option backtest's structure, expiry, placement, wings and management", () => {
    const d = botFromOptionBacktest(def({ structure: "iron_condor", dte: 21, short_atr: 3, wing: 5, manage: "take_50" }), run);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.bot.config).toMatchObject({ instrument: "SPY", structure: "iron_condor", dte: 21, short_atr: 3, width: 5, profit_target: 0.5 });
    expect(d.bot.source?.held_back).toEqual({ trades: 40, win_rate: 65, expectancy: 12 });
    expect(isTested(d.bot)).toBe(true);
  });

  it("maps each management and the signal", () => {
    const c = (manage: string, extra = {}) => { const d = botFromOptionBacktest(def({ structure: "bull_put", dte: 21, short_atr: 3, wing: 5, manage, ...extra }), run); return d.ok ? d.bot.config : null; };
    expect(c("close_21")?.close_days_left).toBe(21);
    expect(c("stop_2x")?.stop_mult).toBe(2);
    expect(c("expiry")?.profit_target).toBeUndefined();
    expect(c("expiry", { signal_rule: "squeeze_on", signal_params: {} })?.signal_rule).toBe("squeeze_on");
  });

  it("says why when the bot can't run it", () => {
    expect(botFromOptionBacktest(def({ structure: "call_condor", dte: 21, wing: 5, manage: "expiry" }), run)).toMatchObject({ ok: false, why: expect.stringMatching(/call or put condors/) });
    expect(botFromOptionBacktest(def({ structure: "iron_condor", dte: 0, wing: 5, manage: "expiry", intraday: true }), run).ok).toBe(false);
    expect(botFromOptionBacktest(def({ structure: "iron_condor", dte: 3, wing: 5, manage: "expiry" }), undefined).ok).toBe(false);
  });

  it("takes a 0DTE survivor's settings as they are", () => {
    const d = botFromResearch({ strategy: "XSP · iron condor", config: { instrument: "XSP", structure: "iron_condor", entry: "10:30", short_delta: 0.15, width: 1, stop_mult: null, skip_tags: [] },
      validation: { trades: 30, win_rate: 80, expectancy: 9 } });
    expect(d.ok && d.bot.config).toEqual({ instrument: "XSP", structure: "iron_condor", entry: "10:30", short_delta: 0.15, width: 1, dte: 0 });
    expect(botFromResearch({ strategy: "old" }).ok).toBe(false);
  });

  it("is untested once a setting changes, and tested again when put back", () => {
    const d = botFromOptionBacktest(def({ structure: "iron_condor", dte: 9, short_atr: 1, wing: 5, manage: "expiry" }), run);
    if (!d.ok) throw new Error("expected a bot");
    expect(isTested({ ...d.bot, config: { ...d.bot.config, width: 2 } })).toBe(false);
    expect(isTested({ ...d.bot, config: { ...d.bot.config, exit_time: null } })).toBe(true);   // an empty setting isn't a change
    expect(isTested({ ...d.bot, source: null })).toBe(false);
  });
});

const order = (o: Partial<PaperOrder>): PaperOrder => ({ id: 1, created_at: "2026-11-18T15:05:00Z", symbol: "SPY", structure: "iron_condor", expiry: "2026-11-20",
  legs: [{ right: "P", side: "buy", strike: 590, qty: 1 }, { right: "P", side: "sell", strike: 595, qty: 1 }], quantity: 1, limit_price: 1, price_kind: "credit",
  max_loss: 400, status: "closed", refusals: [], reason: null, pnl: 50, strategy_id: "b1", updated_at: "2026-11-19T20:00:00Z", ...o });

describe("a bot's paper results and its marks on the chart", () => {
  it("counts closed trades against the bot", () => {
    const r = paperResults([order({}), order({ id: 2, pnl: -150 }), order({ id: 3, status: "filled", pnl: null }), order({ id: 4, strategy_id: "other" })], "b1");
    expect(r).toEqual({ trades: 2, win_rate: 50, expectancy: -50, open: 1 });
  });

  it("draws open positions in the bot colour and marks entries and closes", () => {
    const { positions, markers } = botsOnChart([order({}), order({ id: 2, status: "filled", pnl: null }), order({ id: 3, symbol: "QQQ" })], { b1: "My bot" }, "SPY");
    expect(positions.map((p) => [p.id, p.status, p.note])).toEqual([["bot-2", "bot", "My bot"]]);
    expect(markers.map((x) => x.text)).toEqual(["Bot in", "+$50", "Bot in"]);
  });
});
