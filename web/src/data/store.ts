// Where the app's data lives. SupabaseStore is the real one; DemoStore keeps
// everything in this browser with made-up candles (used by the tests, and by
// opening the app with ?demo in the address).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Candles, emptyCandles, madeUpCandles, Timeframe } from "./candles";
import type { LiveBar } from "./live";
import type { ClaudeMessage, ClaudeReply } from "./claude";
import type { OptionPosition } from "./options";
import { analyse, historicalVol, positionAt } from "./pricing";
import { BacktestRun, BacktestTrade, BotRequest, BotStrategy, MarketSnapshot, ResearchRun, OptionRun, OptionStrategyDef, OptionTradeRow, ChartView, DEFAULT_FAVOURITES, DEFAULT_LIMITS, PaperOrder, PatternRun, SafetyLimits, UserSettings, ScanDef, ScanResult, ScanRun, StrategyDef, SymbolInfo, Watchlist, Workspace } from "./model";
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
  /** Today's live 1-minute bars for a symbol from `sinceIso` on (written by the data program in US hours). */
  liveBars(symbol: string, sinceIso: string): Promise<LiveBar[]>;

  workspaces(): Promise<Workspace[]>;
  saveWorkspace(w: Workspace): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  watchlists(): Promise<Watchlist[]>;
  saveWatchlist(w: Watchlist): Promise<Watchlist>;
  deleteWatchlist(id: Watchlist["id"]): Promise<void>;

  views(): Promise<ChartView[]>;
  saveView(v: ChartView): Promise<ChartView>;
  deleteView(id: string): Promise<void>;

  /** The person's settings (favourites); the defaults until they change one. */
  settings(): Promise<UserSettings>;
  saveSettings(s: UserSettings): Promise<void>;

  /** Option structures drawn on the charts (plans; never orders). */
  positions(): Promise<OptionPosition[]>;
  savePosition(p: OptionPosition): Promise<OptionPosition>;
  deletePosition(id: string): Promise<void>;

  /** Phase 5's safety limits (the defaults until Ben saves them), the bot's orders, and Ben's controls. */
  safetyLimits(): Promise<SafetyLimits>;
  saveSafetyLimits(l: SafetyLimits): Promise<SafetyLimits>;
  paperOrders(): Promise<PaperOrder[]>;
  decideOrder(id: number, approve: boolean): Promise<void>;
  killSwitch(): Promise<number>;
  /** Ask the bot to order a chart structure (paper; still needs approval after the rails) or close a paper position. */
  requestOrder(positionId: string, quantity: number): Promise<void>;
  requestClose(orderId: number): Promise<void>;
  botRequests(): Promise<BotRequest[]>;
  /** The bot's own strategies: added, switched on and off, and removed by Ben; every change audited. */
  botStrategies(): Promise<BotStrategy[]>;
  /** The bot's latest market snapshot, and today's no-trade notes from its strategies. */
  marketSnapshot(symbol: string): Promise<MarketSnapshot | null>;
  strategyNoTrades(sinceIso: string): Promise<{ strategy: string; why: string }[]>;
  /** The latest 0DTE research matrix run. */
  latestResearch(): Promise<ResearchRun | null>;
  saveBotStrategy(s: BotStrategy): Promise<void>;
  deleteBotStrategy(id: string): Promise<void>;

  strategies(): Promise<StrategyDef[]>;
  /** The latest manual or scheduled run of each strategy, with its metrics. Re-runs are checks, not shown. */
  latestBacktests(): Promise<Record<string, BacktestRun>>;
  backtestTrades(runId: number): Promise<BacktestTrade[]>;
  /** The latest pattern lab run (not a re-run check), with the patterns it kept. */
  latestPatternRun(): Promise<PatternRun | null>;
  /** Option-structure backtests: the strategies, the latest run of each (without its trades), and one run's trades. */
  optionStrategies(): Promise<OptionStrategyDef[]>;
  latestOptionRuns(): Promise<Record<string, OptionRun>>;
  optionTrades(runId: number): Promise<OptionTradeRow[]>;

  /** Send the conversation to Claude (the Supabase function); get back its new turns and actions for the app. */
  askClaude(messages: ClaudeMessage[]): Promise<ClaudeReply>;

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

  async liveBars(symbol: string, sinceIso: string): Promise<LiveBar[]> {
    const rows = this.check(await this.sb.from("live_bars").select("ts,open,high,low,close,volume,delayed")
      .eq("symbol", symbol).gte("ts", sinceIso).order("ts").limit(1000)) as { ts: string; open: number; high: number; low: number; close: number; volume: number; delayed: boolean }[];
    return rows.map((r) => ({ time: Date.parse(r.ts) / 1000, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, delayed: r.delayed }));
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

  async settings(): Promise<UserSettings> {
    const rows = this.check(await this.sb.from("user_settings").select("favourites")) as UserSettings[];
    return rows[0] ?? { favourites: DEFAULT_FAVOURITES };
  }

  async saveSettings(st: UserSettings) {
    this.check(await this.sb.from("user_settings").upsert({ favourites: st.favourites }));
  }

  async positions() {
    return this.check(await this.sb.from("option_positions").select("*").neq("status", "closed").order("created_at")) as OptionPosition[];
  }

  async savePosition(p: OptionPosition) {
    const { updated_at: _skip, ...row } = p;
    return this.check(await this.sb.from("option_positions").upsert(row).select().single()) as OptionPosition;
  }

  async deletePosition(id: string) {
    this.check(await this.sb.from("option_positions").delete().eq("id", id));
  }

  async safetyLimits(): Promise<SafetyLimits> {
    const rows = this.check(await this.sb.from("safety_limits").select("*")) as (SafetyLimits & { owner: string })[];
    if (!rows[0]) return DEFAULT_LIMITS;
    const { owner: _o, ...l } = rows[0];
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return { ...l, max_loss_per_trade: Number(l.max_loss_per_trade), max_loss_per_day: num(l.max_loss_per_day), max_capital_at_risk: Number(l.max_capital_at_risk) };
  }

  async saveSafetyLimits(l: SafetyLimits) {
    const { updated_at: _skip, ...row } = l;
    this.check(await this.sb.from("safety_limits").upsert(row));
    return this.safetyLimits();
  }

  async paperOrders() {
    return this.check(await this.sb.from("paper_orders").select("*").order("created_at", { ascending: false }).limit(200)) as PaperOrder[];
  }

  async decideOrder(id: number, approve: boolean) {
    this.check(await this.sb.rpc("decide_order", { order_id: id, approve }));
  }

  async killSwitch() {
    return this.check(await this.sb.rpc("kill_switch")) as unknown as number;
  }

  async requestOrder(positionId: string, quantity: number) {
    this.check(await this.sb.from("bot_requests").insert({ kind: "open", position_id: positionId, quantity }));
  }

  async requestClose(orderId: number) {
    this.check(await this.sb.from("bot_requests").insert({ kind: "close", order_id: orderId, quantity: 1 }));
  }

  async marketSnapshot(symbol: string) {
    const rows = this.check(await this.sb.from("market_snapshots").select("*").eq("symbol", symbol)) as MarketSnapshot[];
    if (!rows[0]) return null;
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const r = rows[0];
    return { ...r, price: Number(r.price), vix: n(r.vix), vix1d: n(r.vix1d), expected_move: n(r.expected_move), or_high: n(r.or_high), or_low: n(r.or_low), vwap: n(r.vwap) };
  }

  async strategyNoTrades(sinceIso: string) {
    const rows = this.check(await this.sb.from("audit_log").select("detail").eq("action", "strategy_no_trade").gte("at", sinceIso)) as { detail: { strategy: string; why: string } }[];
    return rows.map((r) => ({ strategy: r.detail.strategy, why: r.detail.why }));
  }

  async latestResearch() {
    const rows = this.check(await this.sb.from("research_runs").select("*").eq("kind", "0dte_matrix").order("ran_at", { ascending: false }).limit(1)) as ResearchRun[];
    return rows[0] ?? null;
  }

  async botStrategies() {
    return this.check(await this.sb.from("bot_strategies").select("id,label,config,enabled,source").order("created_at")) as BotStrategy[];
  }

  async saveBotStrategy(s: BotStrategy) {
    const row = { label: s.label, config: s.config, enabled: s.enabled, source: s.source ?? null };
    if (s.id) this.check(await this.sb.from("bot_strategies").update(row).eq("id", s.id));
    else this.check(await this.sb.from("bot_strategies").insert(row));
  }

  async deleteBotStrategy(id: string) {
    this.check(await this.sb.from("bot_strategies").delete().eq("id", id));
  }

  async botRequests() {
    return this.check(await this.sb.from("bot_requests").select("*").order("created_at", { ascending: false }).limit(50)) as BotRequest[];
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

  async optionStrategies() {
    return this.check(await this.sb.from("option_strategies").select("*").eq("enabled", true).order("position")) as OptionStrategyDef[];
  }

  async latestOptionRuns() {
    const rows = this.check(await this.sb.from("option_runs").select("id,strategy_id,ran_at,source,split_date,held_back_burned,report")
      .neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(200)) as OptionRun[];
    const out: Record<string, OptionRun> = {};
    for (const r of rows) if (!out[r.strategy_id]) out[r.strategy_id] = r;
    return out;
  }

  async optionTrades(runId: number) {
    const rows = this.check(await this.sb.from("option_runs").select("trades").eq("id", runId)) as { trades: OptionTradeRow[] }[];
    return rows[0]?.trades ?? [];
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

  async askClaude(messages: ClaudeMessage[]): Promise<ClaudeReply> {
    const { data, error } = await this.sb.functions.invoke("claude", { body: { messages } });
    if (error) {
      // The function's own message (cap reached, key missing...) is in the response body.
      let msg = error.message;
      try { const body = await (error as { context?: Response }).context?.json(); if (body?.error) msg = body.error; } catch { /* keep the generic message */ }
      throw new Error(msg);
    }
    return data as ClaudeReply;
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
interface DemoData {
  workspaces: Workspace[];
  watchlists: Watchlist[];
  views: ChartView[];
  positions: OptionPosition[];
  settings: UserSettings;
  limits: SafetyLimits;
  orders: PaperOrder[];
  requests: BotRequest[];
  strategies: BotStrategy[];
}

/** A made-up proposal, so the demo's Safety screen has something to approve. */
const DEMO_ORDER: PaperOrder = {
  id: 1, created_at: "2026-11-18T14:45:00Z", symbol: "DEMO", structure: "iron_condor", expiry: "2026-11-18",
  legs: [{ right: "P", side: "buy", strike: 117, qty: 1 }, { right: "P", side: "sell", strike: 122, qty: 1 },
    { right: "C", side: "sell", strike: 132, qty: 1 }, { right: "C", side: "buy", strike: 137, qty: 1 }],
  quantity: 1, limit_price: 4.6, price_kind: "credit", max_loss: 40, status: "proposed", refusals: [],
  reason: "Made-up: squeeze on, inside the opening range", pnl: null,
};

export class DemoStore implements Store {
  readonly demo = true;
  private key = "stockwizard.demo";
  private user: User | null = { id: "demo", email: "demo" };
  private listeners = new Set<(u: User | null) => void>();

  private load(): DemoData {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) return { views: [], positions: [], settings: { favourites: DEFAULT_FAVOURITES }, limits: DEFAULT_LIMITS, orders: [structuredClone(DEMO_ORDER)], requests: [], strategies: [], ...JSON.parse(raw) };
    } catch {
      /* storage blocked: start empty */
    }
    return { workspaces: [], views: [], positions: [], settings: { favourites: DEFAULT_FAVOURITES }, limits: DEFAULT_LIMITS, orders: [structuredClone(DEMO_ORDER)], requests: [], strategies: [],
      watchlists: [{ id: "demo-1", name: "Made-up list", is_universe: false, symbols: ["DEMO", "TEST"] }] };
  }

  private save(d: DemoData) {
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

  async settings() { return this.load().settings; }

  async saveSettings(st: UserSettings) {
    const d = this.load();
    d.settings = st;
    this.save(d);
  }

  async positions() { return this.load().positions.filter((p) => p.status !== "closed"); }

  async savePosition(p: OptionPosition) {
    const d = this.load();
    const saved = { ...p, updated_at: new Date().toISOString() };
    d.positions = [...d.positions.filter((x) => x.id !== p.id), saved];
    this.save(d);
    return saved;
  }

  async deletePosition(id: string) {
    const d = this.load();
    d.positions = d.positions.filter((x) => x.id !== id);
    this.save(d);
  }

  async safetyLimits() { return this.load().limits; }

  async saveSafetyLimits(l: SafetyLimits) {
    const d = this.load();
    d.limits = { ...l, updated_at: new Date().toISOString() };
    this.save(d);
    return d.limits;
  }

  async paperOrders() { return this.load().orders; }

  // The demo has no bot: it does the bot's part at once, with theoretical prices, and no rails beyond the per-trade limit.
  async requestOrder(positionId: string, quantity: number) {
    const d = this.load();
    const p = d.positions.find((x) => x.id === positionId);
    if (!p) throw new Error("That structure has been deleted");
    const c = await this.candles(p.symbol, "1d");
    const spot = c.close[c.close.length - 1];
    const vol = historicalVol(c) ?? 0.2;
    const v = positionAt(p, spot, Date.now() / 1000, vol).price / 100;
    const credit = v < 0;
    const price = Math.max(0.05, (credit ? Math.floor(-v / 0.05) : Math.ceil(v / 0.05)) * 0.05);
    const a = analyse(p, spot, vol, Date.now() / 1000);
    const maxLoss = a.maxLoss === null ? null : Math.round(a.maxLoss * quantity * 100) / 100;
    const refused = maxLoss === null || maxLoss > d.limits.max_loss_per_trade;
    d.orders.unshift({
      id: Math.max(0, ...d.orders.map((o) => o.id)) + 1, created_at: new Date().toISOString(), symbol: p.symbol, structure: p.structure,
      expiry: p.expiry, legs: p.legs, quantity, limit_price: Math.round(price * 100) / 100, price_kind: credit ? "credit" : "debit",
      max_loss: maxLoss, status: refused ? "refused" : "proposed", pnl: null,
      refusals: refused ? [{ rail: "per_trade", why: `It could lose $${maxLoss ?? "an unlimited amount"}; the limit per trade is $${d.limits.max_loss_per_trade}.` }] : [],
      reason: "From your structure on the chart. Theoretical price (made-up candles).",
    });
    d.requests = [{ id: d.requests.length + 1, created_at: new Date().toISOString(), kind: "open", position_id: positionId, order_id: null, quantity, status: "done", result: "Proposed" }, ...d.requests];
    this.save(d);
  }

  async requestClose(orderId: number) {
    const d = this.load();
    const o = d.orders.find((x) => x.id === orderId);
    if (!o || o.status !== "filled") throw new Error(`Order ${orderId} isn't an open position`);
    o.status = "closed";
    o.pnl = 0;
    d.requests = [{ id: d.requests.length + 1, created_at: new Date().toISOString(), kind: "close", position_id: null, order_id: orderId, quantity: 1, status: "done", result: "Closed" }, ...d.requests];
    this.save(d);
  }

  async botRequests() { return this.load().requests.filter((q) => q.status === "waiting"); }

  async botStrategies() { return this.load().strategies; }

  async liveBars(): Promise<LiveBar[]> { return []; }   // made-up candles don't move

  async marketSnapshot(): Promise<MarketSnapshot | null> {
    const now = new Date();
    return { symbol: "SPY", taken_at: now.toISOString(), session_date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now),
      price: 600.12, vix: 15.4, vix1d: 13.8, expected_move: 3.9, or_high: 601.5, or_low: 598.2, vwap: 599.6, direction: "neutral", source: "pretend" };
  }

  async strategyNoTrades() { return []; }

  async latestResearch(): Promise<ResearchRun | null> {
    const m = (expectancy: number, win_rate: number) => ({ trades: 140, win_rate, expectancy, profit_factor: 1.4, largest_loss: -420, max_drawdown: -900,
      months_positive_pct: 71, avg_return_on_risk_pct: 5, sharpe: 1.1 });
    const s = (name: string, dev: number, val: number) => ({ strategy: name,
      config: { instrument: "XSP", structure: "iron_condor", entry: "10:30", short_delta: 0.15, width: 1, call_width: null, profit_target: 0.5, stop_mult: null, skip_tags: [] },
      development: m(dev, 88), validation: m(val, 85), walk_forward: [120, -40, 210, 60],
      kitty: { start: 5000, end: 5000 + val * 12, profit: val * 12, profit_pct: val * 12 / 50, lowest: 4700, deepest_drop_pct: -6.5, taken: 120, skipped: 20 },
      by_regime: { vix_under_15: { trades: 40, win_rate: 92, expectancy: 30 }, vix_15_20: { trades: 70, win_rate: 86, expectancy: 12 }, fed_day: { trades: 6, win_rate: 50, expectancy: -80 } } });
    return { id: 1, ran_at: "2026-11-17T09:00:00Z", title: "made-up", modelled: true, result: {
      notes: ["Made-up results for the demo."], periods: { start: "2024-11-19", dev_end: "2025-08-29", val_end: "2026-03-31", end: "2026-11-16" },
      tried: 270, q: 0.1, final_used: false,
      survivors: [s("Made-up condor A", 40, 25), s("Made-up condor B", 30, -12), s("Made-up fly", 20, 8)], best_in_development: [] } };
  }

  async saveBotStrategy(s: BotStrategy) {
    const d = this.load();
    const saved = { ...s, id: s.id || `demo-st-${Date.now()}` };
    d.strategies = [...d.strategies.filter((x) => x.id !== saved.id), saved];
    this.save(d);
  }

  async deleteBotStrategy(id: string) {
    const d = this.load();
    d.strategies = d.strategies.filter((x) => x.id !== id);
    this.save(d);
  }

  async decideOrder(id: number, approve: boolean) {
    const d = this.load();
    const o = d.orders.find((x) => x.id === id);
    if (!o || o.status !== "proposed") throw new Error(`Order ${id} isn't waiting for approval`);
    if (approve && d.limits.kill_switch) throw new Error("The kill switch is on: nothing can be approved");
    o.status = approve ? "approved" : "rejected";
    this.save(d);
  }

  async killSwitch() {
    const d = this.load();
    d.limits = { ...d.limits, kill_switch: true };
    let n = 0;
    for (const o of d.orders) if (o.status === "proposed" || o.status === "approved") { o.status = "cancelled"; n++; }
    this.save(d);
    return n;
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

  async optionStrategies(): Promise<OptionStrategyDef[]> {
    return [
      { id: "demo_ic", label: "Made-up 9-day iron condor", family: "demo", config: { structure: "iron_condor", dte: 9, manage: "expiry", wing: 5, short_atr: 1 },
        start_date: "2006-01-02", split_date: "2021-11-17", position: 0, notes: "Made-up results" },
    ];
  }

  async latestOptionRuns(): Promise<Record<string, OptionRun>> {
    const m = (trades: number, win_rate: number, expectancy: number) => ({
      trades, wins: Math.round((trades * win_rate) / 100), win_rate, next_100_wins_low: win_rate - 8, next_100_wins_high: win_rate + 8,
      avg_win: 95, avg_loss: -210, expectancy, total_pnl: expectancy * trades, max_drawdown: -1450, worst_trade: -430,
      profit_factor: 1.2, avg_return_on_risk: 6.5, longest_losing_streak: 4, take_profit_exits: 0 });
    return { demo_ic: { id: 1, strategy_id: "demo_ic", ran_at: "2026-11-18T09:00:00Z", source: "made-up", split_date: "2021-11-17", held_back_burned: false,
      report: { build: m(445, 64, 38.85), held_back: m(138, 51, 30.86), warnings: ["Modelled prices: Black-Scholes with the VIX as volatility."], skipped: {} } } };
  }

  async optionTrades(): Promise<OptionTradeRow[]> {
    const legs = [{ right: "P" as const, side: "buy" as const, strike: 389, qty: 1 }, { right: "P" as const, side: "sell" as const, strike: 394, qty: 1 },
      { right: "C" as const, side: "sell" as const, strike: 406, qty: 1 }, { right: "C" as const, side: "buy" as const, strike: 411, qty: 1 }];
    return Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 2 + i * 14)).toISOString().slice(0, 10);
      const pnl = i % 3 === 2 ? -55 : 24;   // small made-up trades, each able to lose $90, so the $5,000 kitty can take one at 2%
      return { signal_day: d, entry_day: d, expiry_day: d, exit_day: d, spot_in: 400, spot_out: 400 + (pnl < 0 ? 9 : 1), legs, vol: 0.18,
        credit: 0.3, exit_cost: pnl < 0 ? 0.85 : 0, pnl, max_loss: 90, exit_reason: "expiry" as const };
    });
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

  async askClaude(messages: ClaudeMessage[]): Promise<ClaudeReply> {
    const last = messages[messages.length - 1];
    const asked = typeof last.content === "string" ? last.content : "";
    return {
      added: [{
        role: "assistant",
        content: [
          { type: "tool_use", id: "demo", name: "run_backtest", input: { strategy_id: "demo_a" } },
          { type: "text", text: `Made-up reply to “${asked}”. In the real app I'd run that as a backtest and show the build and held-back years side by side.` },
        ],
      }],
      actions: [{ type: "open_backtest", strategy_id: "demo_a" }],
      note: null,
    };
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
