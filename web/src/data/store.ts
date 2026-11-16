// Where the app's data lives. SupabaseStore is the real one; DemoStore keeps
// everything in this browser with made-up candles (used by the tests, and by
// opening the app with ?demo in the address).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Candles, emptyCandles, madeUpCandles, Timeframe } from "./candles";
import { BacktestRun, BacktestTrade, ChartView, PatternRun, ScanDef, ScanResult, ScanRun, StrategyDef, SymbolInfo, Watchlist, Workspace } from "./model";
import { SUPABASE_KEY, SUPABASE_URL } from "../config";

export interface User {
  id: string;
  email: string;
}

export interface Store {
  readonly demo: boolean;
  currentUser(): Promise<User | null>;
  onUserChange(fn: (u: User | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<"signed-in" | "check-email">;
  signOut(): Promise<void>;

  symbols(): Promise<SymbolInfo[]>;
  candles(symbol: string, tf: Timeframe): Promise<Candles>;

  workspaces(): Promise<Workspace[]>;
  saveWorkspace(w: Workspace): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  watchlists(): Promise<Watchlist[]>;
  saveWatchlist(w: Watchlist): Promise<Watchlist>;
  deleteWatchlist(id: Watchlist["id"]): Promise<void>;

  views(): Promise<ChartView[]>;
  saveView(v: ChartView): Promise<ChartView>;
  deleteView(id: string): Promise<void>;

  strategies(): Promise<StrategyDef[]>;
  /** The latest manual or scheduled run of each strategy, with its metrics. Re-runs are checks, not shown. */
  latestBacktests(): Promise<Record<string, BacktestRun>>;
  backtestTrades(runId: number): Promise<BacktestTrade[]>;
  /** The latest pattern lab run (not a re-run check), with the patterns it kept. */
  latestPatternRun(): Promise<PatternRun | null>;

  scans(): Promise<ScanDef[]>;
  /** The latest scheduled or manual run of each scan, with its matches. Re-runs are checks, not shown. */
  latestRuns(): Promise<Record<string, ScanRun>>;
}

// Prefer the broker's data once it exists; the free source until then.
export const SOURCE_PREFERENCE = ["ibkr", "yahoo-unofficial"];
const PAGE = 1000;
// Enough history to draw and warm up the indicators without loading decades of 5-minute bars.
const MAX_CANDLES: Record<Timeframe, number> = { "5m": 6000, "15m": 4000, "30m": 3000, "1h": 4000, "1d": 6000 };

export class SupabaseStore implements Store {
  readonly demo = false;
  private sb: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.sb =
      client ??
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        // Own storage key: GitHub Pages puts Ben's apps on one origin.
        auth: { storageKey: "stockwizard-auth", persistSession: true, autoRefreshToken: true },
      });
  }

  private check<T>(r: { data: T; error: { message: string } | null }): T {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email ?? "" } : null;
  }

  onUserChange(fn: (u: User | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, s) =>
      fn(s?.user ? { id: s.user.id, email: s.user.email ?? "" } : null),
    );
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return data.session ? "signed-in" : "check-email";
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async symbols() {
    return this.check(await this.sb.from("symbols").select("symbol,market,instrument_type,tradable,name").order("symbol")) as SymbolInfo[];
  }

  async candles(symbol: string, tf: Timeframe): Promise<Candles> {
    for (const source of SOURCE_PREFERENCE) {
      const rows: { ts: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
      while (rows.length < MAX_CANDLES[tf]) {
        const page = this.check(
          await this.sb
            .from("candles")
            .select("ts,open,high,low,close,volume")
            .eq("symbol", symbol)
            .eq("timeframe", tf)
            .eq("source", source)
            .order("ts", { ascending: false })
            .range(rows.length, rows.length + PAGE - 1),
        ) as typeof rows;
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      if (rows.length) {
        rows.reverse();
        return {
          time: rows.map((r) => Date.parse(r.ts) / 1000),
          open: rows.map((r) => r.open),
          high: rows.map((r) => r.high),
          low: rows.map((r) => r.low),
          close: rows.map((r) => r.close),
          volume: rows.map((r) => r.volume),
          source,
        };
      }
    }
    return emptyCandles();
  }

  async workspaces() {
    return this.check(await this.sb.from("workspaces").select("*").order("position")) as Workspace[];
  }

  async saveWorkspace(w: Workspace) {
    const { updated_at: _skip, ...row } = w;
    return this.check(await this.sb.from("workspaces").upsert(row).select().single()) as Workspace;
  }

  async deleteWorkspace(id: string) {
    this.check(await this.sb.from("workspaces").delete().eq("id", id));
  }

  async watchlists() {
    const rows = this.check(
      await this.sb.from("watchlists").select("id,name,is_universe,watchlist_symbols(symbol,position)").order("name"),
    ) as { id: number; name: string; is_universe: boolean; watchlist_symbols: { symbol: string; position: number }[] }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      is_universe: r.is_universe,
      symbols: [...r.watchlist_symbols].sort((a, b) => a.position - b.position).map((s) => s.symbol),
    }));
  }

  async saveWatchlist(w: Watchlist) {
    // The id is generated by the database, so a new list is an insert and an existing one an update.
    const fields = { name: w.name, is_universe: w.is_universe };
    const saved = this.check(
      typeof w.id === "number"
        ? await this.sb.from("watchlists").update(fields).eq("id", w.id).select().single()
        : await this.sb.from("watchlists").insert(fields).select().single(),
    ) as { id: number };
    this.check(await this.sb.from("watchlist_symbols").delete().eq("watchlist_id", saved.id));
    if (w.symbols.length) {
      this.check(
        await this.sb
          .from("watchlist_symbols")
          .insert(w.symbols.map((symbol, position) => ({ watchlist_id: saved.id, symbol, position }))),
      );
    }
    return { ...w, id: saved.id };
  }

  async deleteWatchlist(id: Watchlist["id"]) {
    this.check(await this.sb.from("watchlists").delete().eq("id", id));
  }

  async views() {
    return this.check(await this.sb.from("views").select("*").order("position")) as ChartView[];
  }

  async saveView(v: ChartView) {
    const { updated_at: _skip, ...row } = v;
    return this.check(await this.sb.from("views").upsert(row).select().single()) as ChartView;
  }

  async deleteView(id: string) {
    this.check(await this.sb.from("views").delete().eq("id", id));
  }

  async strategies() {
    return this.check(await this.sb.from("strategies").select("id,label,family,config,version,start_date,split_date,position,notes").eq("enabled", true).order("position")) as StrategyDef[];
  }

  async latestBacktests() {
    const runs = this.check(
      await this.sb.from("backtest_runs")
        .select("id,strategy_id,ran_at,as_of,start_date,split_date,source,warnings,held_back_burned,skipped")
        .neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(200),
    ) as Omit<BacktestRun, "metrics">[];
    const latest: Record<string, BacktestRun> = {};
    for (const r of runs) if (!latest[r.strategy_id]) latest[r.strategy_id] = { ...r, metrics: [] };
    const ids = Object.values(latest).map((r) => r.id);
    if (ids.length) {
      const rows = this.check(
        await this.sb.from("backtest_metrics").select("run_id,period,kind,metrics,position").in("run_id", ids).order("position"),
      ) as (BacktestRun["metrics"][number] & { run_id: number })[];
      const byId = new Map(Object.values(latest).map((r) => [r.id, r]));
      for (const { run_id, ...m } of rows) byId.get(run_id)?.metrics.push(m);
    }
    return latest;
  }

  async latestPatternRun() {
    const runs = this.check(
      await this.sb.from("pattern_runs").select("id,question,settings,start_date,split_date,ran_at,as_of,source,counts,sealed_burned")
        .neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(1),
    ) as Omit<PatternRun, "candidates">[];
    if (!runs.length) return null;
    const candidates = this.check(
      await this.sb.from("pattern_candidates").select("n,label,status,discovery,sealed").eq("run_id", runs[0].id).order("n"),
    ) as PatternRun["candidates"];
    return { ...runs[0], candidates };
  }

  async backtestTrades(runId: number) {
    const out: BacktestTrade[] = [];
    for (let from = 0; ; from += 1000) {
      const page = this.check(
        await this.sb.from("backtest_trades").select("n,period,signal_ts,entry_ts,entry_price,exit_ts,exit_price,exit_reason,bars,return_pct")
          .eq("run_id", runId).order("n").range(from, from + 999),
      ) as BacktestTrade[];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  async scans() {
    return this.check(await this.sb.from("scans").select("id,label,rule,timeframe,params,symbols,tab,position").eq("enabled", true).order("position")) as ScanDef[];
  }

  async latestRuns() {
    const runs = this.check(
      await this.sb.from("scan_runs").select("id,scan_id,ran_at,as_of,symbols,source,matches,notes")
        .neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(200),
    ) as Omit<ScanRun, "results">[];
    const latest = latestPerScan(runs, []);
    const ids = Object.values(latest).map((r) => r.id);
    if (!ids.length) return latest;
    const results = this.check(
      await this.sb.from("scan_results").select("run_id,symbol,candle_ts,direction,vals,context").in("run_id", ids),
    ) as (ScanResult & { run_id: number })[];
    return latestPerScan(runs, results);
  }
}

export function latestPerScan(runs: Omit<ScanRun, "results">[], results: (ScanResult & { run_id: number })[]) {
  const out: Record<string, ScanRun> = {};
  for (const r of runs) if (!out[r.scan_id]) out[r.scan_id] = { ...r, results: [] };
  const byId = new Map(Object.values(out).map((r) => [r.id, r]));
  for (const res of results) {
    const { run_id, ...rest } = res;
    byId.get(run_id)?.results.push(rest);
  }
  for (const r of Object.values(out)) r.results.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}

/** Everything in this browser's storage, made-up candles. Never touches the network. */
export class DemoStore implements Store {
  readonly demo = true;
  private key = "stockwizard.demo";
  private user: User | null = { id: "demo", email: "demo" };
  private listeners = new Set<(u: User | null) => void>();

  private load(): { workspaces: Workspace[]; watchlists: Watchlist[]; views: ChartView[] } {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) return { views: [], ...JSON.parse(raw) };
    } catch {
      /* storage blocked: start empty */
    }
    return { workspaces: [], views: [], watchlists: [{ id: "demo-1", name: "Made-up list", is_universe: false, symbols: ["DEMO", "TEST"] }] };
  }

  private save(d: { workspaces: Workspace[]; watchlists: Watchlist[]; views: ChartView[] }) {
    try {
      localStorage.setItem(this.key, JSON.stringify(d));
    } catch {
      /* storage blocked: keep going in memory */
    }
  }

  async currentUser() { return this.user; }
  onUserChange(fn: (u: User | null) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async signIn() { this.user = { id: "demo", email: "demo" }; this.listeners.forEach((f) => f(this.user)); }
  async signUp() { await this.signIn(); return "signed-in" as const; }
  async signOut() { this.user = null; this.listeners.forEach((f) => f(null)); }

  async symbols(): Promise<SymbolInfo[]> {
    return [
      { symbol: "DEMO", market: "US", instrument_type: "etf", tradable: true, name: "Made-up ETF" },
      { symbol: "TEST", market: "US", instrument_type: "stock", tradable: true, name: "Made-up stock" },
    ];
  }

  async candles(symbol: string, tf: Timeframe) {
    return madeUpCandles(tf, 600, [...symbol].reduce((a, ch) => a + ch.charCodeAt(0), 0));
  }

  async workspaces() { return this.load().workspaces.sort((a, b) => a.position - b.position); }

  async saveWorkspace(w: Workspace) {
    const d = this.load();
    const saved = { ...w, updated_at: new Date().toISOString() };
    d.workspaces = [...d.workspaces.filter((x) => x.id !== w.id), saved];
    this.save(d);
    return saved;
  }

  async deleteWorkspace(id: string) {
    const d = this.load();
    d.workspaces = d.workspaces.filter((x) => x.id !== id);
    this.save(d);
  }

  async watchlists() { return this.load().watchlists; }

  async saveWatchlist(w: Watchlist) {
    const d = this.load();
    const saved = { ...w, id: typeof w.id === "string" && w.id ? w.id : `demo-${Date.now()}` };
    d.watchlists = [...d.watchlists.filter((x) => x.id !== saved.id), saved];
    this.save(d);
    return saved;
  }

  async deleteWatchlist(id: Watchlist["id"]) {
    const d = this.load();
    d.watchlists = d.watchlists.filter((x) => x.id !== id);
    this.save(d);
  }

  async views() { return this.load().views.sort((a, b) => a.position - b.position); }

  async saveView(v: ChartView) {
    const d = this.load();
    const saved = { ...v, updated_at: new Date().toISOString() };
    d.views = [...d.views.filter((x) => x.id !== v.id), saved];
    this.save(d);
    return saved;
  }

  async deleteView(id: string) {
    const d = this.load();
    d.views = d.views.filter((x) => x.id !== id);
    this.save(d);
  }

  async strategies(): Promise<StrategyDef[]> {
    const cfg = { signal_symbol: "DEMO", trade_symbol: "TEST", study: true };
    return [
      { id: "demo_a", label: "Made-up signal → +40%", family: "demo", config: cfg, version: 1, start_date: "2006-01-02", split_date: "2021-11-17", position: 0, notes: "Win: +40% before -15%, within 20 trading days" },
      { id: "demo_b", label: "Made-up signal → level 22", family: "demo", config: cfg, version: 1, start_date: "2006-01-02", split_date: "2021-11-17", position: 1, notes: null },
    ];
  }

  async latestBacktests(): Promise<Record<string, BacktestRun>> {
    const m = (trades: number, target_rate: number, lo: number, hi: number, win_rate: number) =>
      ({ trades, targets_hit: Math.round(trades * target_rate / 100), target_rate, next_100_targets_low: lo, next_100_targets_high: hi,
         wins: Math.round(trades * win_rate / 100), win_rate, next_100_wins_low: lo, next_100_wins_high: hi, avg_win_pct: 22.5, avg_loss_pct: -9.1,
         profit_factor: 1.4, expectancy_pct: 2.1, return_pct: 35.2, max_drawdown_pct: -28.4, longest_losing_streak: 6,
         time_in_market_pct: 18.2, avg_bars_held: 8.4, exits: { target: 10, stop: 20, time: 5 } });
    const run = (id: number, strategy_id: string, warnings: string[] = []): BacktestRun => ({
      id, strategy_id, ran_at: "2026-11-17T09:00:00Z", as_of: "2026-11-17T09:00:00Z", start_date: "2006-01-02", split_date: "2021-11-17",
      source: "made-up", warnings, held_back_burned: false, skipped: { already_in_trade: 12 },
      metrics: [
        { period: "build", kind: "build", metrics: m(99, 13, 7, 22, 25), position: 0 },
        { period: "held_back", kind: "held_back", metrics: m(32, 22, 11, 38, 28), position: 1 },
        { period: "2006-01-02..2009-01-01", kind: "window", metrics: { ...m(30, 20, 9, 35, 27), period: "build" }, position: 2 },
        { period: "2021-01-02..2024-01-01", kind: "window", metrics: { ...m(20, 25, 10, 45, 30), period: "both" }, position: 3 },
      ],
    });
    return { demo_a: run(1, "demo_a"), demo_b: run(2, "demo_b", ["Few trades: the win-rate ranges are wide, so treat the win rates as rough."]) };
  }

  async latestPatternRun(): Promise<PatternRun | null> {
    const d = (episodes: number, hits: number, q: number) => ({ episodes, hits, rate: hits / episodes, lift: hits / episodes / 0.24, p: 0.0001, q, stable: q <= 0.05 });
    return {
      id: 1, question: "What made-up conditions come before TEST rising 30% or more within 10 trading days?",
      settings: { rise_pct: 30, days: 10, min_episodes: 20, fdr_q: 0.05, survivors: 8 },
      start_date: "2006-01-02", split_date: "2021-11-17", ran_at: "2026-11-17T09:00:00Z", as_of: "2026-11-17T09:00:00Z", source: "made-up",
      counts: { tried: 5525, enough_episodes: 3958, passed_fdr: 1, stable: 1, survivors: 1, base_rate: 0.24, sealed_base_rate: 0.28 },
      sealed_burned: false,
      candidates: [
        { n: 0, label: "DEMO near its 20-day high and TEST at or below 14", status: "survivor", discovery: d(40, 21, 0.03),
          sealed: { trades: 9, hits: 4, rate: 4 / 9, base_rate: 0.28, lift: 1.6, p: 0.2 } },
        { n: 1, label: "DEMO volume at or above 1.5× its 20-day average", status: "not_significant", discovery: d(44, 23, 0.066), sealed: {} },
      ],
    };
  }

  async backtestTrades(): Promise<BacktestTrade[]> {
    return [
      { n: 0, period: "build", signal_ts: "2008-09-15T04:00:00Z", entry_ts: "2008-09-16T04:00:00Z", entry_price: 25.1, exit_ts: "2008-09-29T04:00:00Z", exit_price: 35.14, exit_reason: "target", bars: 10, return_pct: 40 },
      { n: 1, period: "held_back", signal_ts: "2022-01-20T05:00:00Z", entry_ts: "2022-01-21T05:00:00Z", entry_price: 25.6, exit_ts: "2022-01-27T05:00:00Z", exit_price: 21.76, exit_reason: "stop", bars: 5, return_pct: -15 },
    ];
  }

  async scans(): Promise<ScanDef[]> {
    const def = (id: string, label: string, rule: string, timeframe: Timeframe, tab: ScanDef["tab"], position: number): ScanDef =>
      ({ id, label, rule, timeframe, params: {}, symbols: tab === "spy" ? ["SPY"] : null, tab, position });
    return [
      def("squeeze_on_1d", "Squeeze on", "squeeze_on", "1d", "squeeze_on", 0),
      def("squeeze_on_1h", "Squeeze on", "squeeze_on", "1h", "squeeze_on", 1),
      def("squeeze_fired_1d", "Squeeze fired", "squeeze_fired", "1d", "squeeze_fired", 0),
      def("breakout_1d", "Breakouts", "breakout", "1d", "breakout", 0),
      def("spy_trend_break", "SPY trend break", "trend_break", "1d", "spy", 0),
      def("spy_drawdown", "SPY drawdown", "drawdown", "1d", "spy", 1),
    ];
  }

  async latestRuns(): Promise<Record<string, ScanRun>> {
    const when = new Date(Date.now() - 3600_000).toISOString();
    const run = (id: number, scan_id: string, results: ScanResult[]): ScanRun =>
      ({ id, scan_id, ran_at: when, as_of: when, symbols: ["DEMO", "TEST"], source: "made-up", matches: results.length, notes: null, results });
    const r = (symbol: string, direction: ScanResult["direction"], vals: ScanResult["vals"], context = {}): ScanResult =>
      ({ symbol, candle_ts: when, direction, vals, context });
    return {
      squeeze_on_1d: run(1, "squeeze_on_1d", [r("DEMO", "up", { candles_on: 6, momentum: 0.42 })]),
      squeeze_on_1h: run(2, "squeeze_on_1h", []),
      squeeze_fired_1d: run(3, "squeeze_fired_1d", [r("TEST", "down", { momentum: -0.8 })]),
      breakout_1d: run(4, "breakout_1d", [r("DEMO", "up", { level: 101.5, volume_ratio: 1.3 })]),
      spy_trend_break: run(5, "spy_trend_break", []),
      spy_drawdown: run(6, "spy_drawdown", [r("SPY", "down", { drawdown_pct: -5.4, first_day: 1 }, { "^VIX": 19.2 })]),
    };
  }
}

// Candles read recently, shared by the cards on a page and the full-screen chart.
const candleCache = new Map<string, { at: number; candles: Promise<Candles> }>();
const CACHE_MS = 5 * 60_000;

export function cachedCandles(store: Store, symbol: string, tf: Timeframe): Promise<Candles> {
  const key = `${store.demo ? "demo" : "db"}|${symbol}|${tf}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.candles;
  const candles = store.candles(symbol, tf);
  candleCache.set(key, { at: Date.now(), candles });
  candles.catch(() => candleCache.delete(key));
  return candles;
}
