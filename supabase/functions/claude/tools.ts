// The tools Claude has inside Stock Wizard (SPEC.md, In-app Claude).
//
// Can: read candles, scans, backtests and pattern-lab results; create
// indicator, scan and strategy settings (always new, never overwriting);
// put an indicator on Ben's chart; run backtests.
// Cannot: there are no tools for orders, safety limits, approval mode, the
// paper/live setting, keys, or the audit log. Every action is audit-logged.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import type Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import type { Candles, Timeframe } from "./lib/data/candles.ts";
import { compute, REGISTRY } from "./lib/indicators/index.ts";
import { RULES } from "./lib/engine/scans.ts";
import { report, run, Strategy } from "./lib/engine/backtest.ts";

export const ENGINE_VERSION = "ts-0.4.0";
const START = "2006-01-02";
const SPLIT = "2021-11-17"; // the last 5 years held back (Ben, 17 Nov 2026)
const WARM_UP_DAYS = 500;
const SOURCES = ["ibkr", "yahoo-unofficial"];
const TIMEFRAMES = ["5m", "15m", "30m", "1h", "1d"];

const obj = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: "object", properties, required, additionalProperties: false }) as const;
const str = (description: string) => ({ type: "string", description });
const numOrNull = (description: string) => ({ anyOf: [{ type: "number" }, { type: "null" }], description });

export const TOOLS: Anthropic.Tool[] = [
  { name: "list_symbols", description: "Symbols in the database: ticker, market (US/ASX), type, whether tradable or watch-only.", strict: true, input_schema: obj({}, []) },
  {
    name: "get_candles", strict: true,
    description: "The latest candles for a symbol (oldest first): date/time in New York, open, high, low, close, volume. At most 120.",
    input_schema: obj({ symbol: str("e.g. SPY, ^VIX"), timeframe: { type: "string", enum: TIMEFRAMES }, count: { type: "integer", description: "1 to 120" } }, ["symbol", "timeframe", "count"]),
  },
  { name: "list_indicators", description: "The indicator library: names, what each is, default settings, whether it draws on the price or in its own pane.", strict: true, input_schema: obj({}, []) },
  {
    name: "compute_indicator", strict: true,
    description: "Compute an indicator from the library on a symbol and return its latest values (at most 60).",
    input_schema: obj({
      symbol: str("ticker"), timeframe: { type: "string", enum: TIMEFRAMES }, name: str("indicator name from list_indicators"),
      params_json: str('settings as a JSON object, e.g. {"length": 50}; "{}" for the defaults'), count: { type: "integer", description: "1 to 60" },
    }, ["symbol", "timeframe", "name", "params_json", "count"]),
  },
  {
    name: "add_indicator_to_chart", strict: true,
    description: "Put an indicator from the library, with these settings, on the chart tab Ben has open. Saves the settings as an indicator definition.",
    input_schema: obj({ name: str("indicator name"), params_json: str("settings as a JSON object"), label: str("a short name for it") }, ["name", "params_json", "label"]),
  },
  { name: "list_scan_rules", description: "The scan and signal rules (used by scans and as backtest signals), with their default settings.", strict: true, input_schema: obj({}, []) },
  { name: "get_scans", description: "Every scan with its latest run: when, how many symbols, and what matched.", strict: true, input_schema: obj({}, []) },
  {
    name: "create_scan", strict: true,
    description: "Create a new scan. It runs every night after the US close and shows in the Scanner's 'Mine' tab. Never changes an existing scan.",
    input_schema: obj({
      label: str("short name"), rule: str("a rule from list_scan_rules"), timeframe: { type: "string", enum: ["1h", "1d"] },
      params_json: str("rule settings as a JSON object"), symbols: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }], description: "fixed symbols, or null for the scanner universe" },
    }, ["label", "rule", "timeframe", "params_json", "symbols"]),
  },
  { name: "get_strategies", description: "Every backtest strategy with its settings and its latest run's results for the build and held-back periods.", strict: true, input_schema: obj({}, []) },
  {
    name: "create_strategy", strict: true,
    description: "Create a new backtest strategy (a signal on one symbol, a trade on another, exits). Always a new strategy, never a change to an old one. Daily candles; build period 2006 to 16 Nov 2021, held back from 17 Nov 2021.",
    input_schema: obj({
      label: str("short name"), family: str("the hypothesis family it belongs to, e.g. spy_vix_low; strategies that are variations of one idea share a family"),
      signal_symbol: str("e.g. SPY"), signal_rule: str("a rule from list_scan_rules"), signal_params_json: str("rule settings as a JSON object"),
      trade_symbol: str("e.g. ^VIX"), target_pct: numOrNull("exit when up this %, or null"), target_level: numOrNull("or exit at this price, or null"),
      stop_pct: numOrNull("exit when down this %, or null"), max_bars: { type: "integer", description: "time limit in trading days" },
      cost_pct: { type: "number", description: "cost per fill in %, 0 for a study on an index that can't be traded" }, notes: str("one line: what counts as working"),
      filter_symbol: { anyOf: [{ type: "string" }, { type: "null" }], description: "take a signal only when this symbol's close that day is inside the limits below, e.g. ^VIX; null for no filter" },
      filter_max: numOrNull("the filter symbol at or below this, e.g. 15; or null"), filter_min: numOrNull("the filter symbol at or above this; or null"),
    }, ["label", "family", "signal_symbol", "signal_rule", "signal_params_json", "trade_symbol", "target_pct", "target_level", "stop_pct", "max_bars", "cost_pct", "notes", "filter_symbol", "filter_max", "filter_min"]),
  },
  {
    name: "run_backtest", strict: true,
    description: "Run a strategy bar by bar on the stored daily candles and save the run. Returns the build and held-back results side by side.",
    input_schema: obj({ strategy_id: str("from get_strategies or create_strategy") }, ["strategy_id"]),
  },
  { name: "get_pattern_lab", description: "The pattern lab's latest run: its question, how many patterns were tried and passed each check, survivors and the closest near-misses.", strict: true, input_schema: obj({}, []) },
];

export interface Ctx {
  db: SupabaseClient;       // secret key: server only
  userId: string;
  actions: Record<string, unknown>[];  // things for the app to do (open a backtest, add an indicator)
}

const nyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const nyTime = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const when = (t: number, tf: string) => (tf === "1d" ? nyDate : nyTime).format(new Date(t * 1000));
const r = (v: number | null | undefined, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toPrecision(d + 2)));

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function audit(ctx: Ctx, action: string, detail: Record<string, unknown>) {
  check(await ctx.db.from("audit_log").insert({ actor: "claude", user_id: ctx.userId, action, detail }));
}

function parseParams(json: string): Record<string, number> {
  const p = JSON.parse(json || "{}");
  if (typeof p !== "object" || p === null || Array.isArray(p)) throw new Error("settings must be a JSON object");
  for (const [k, v] of Object.entries(p)) if (typeof v !== "number" && typeof v !== "string") throw new Error(`setting ${k} must be a number`);
  return p;
}

export async function readCandles(db: SupabaseClient, symbol: string, tf: string, opts: { count?: number; from?: string }): Promise<Candles> {
  for (const source of SOURCES) {
    const rows: { ts: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      let q = db.from("candles").select("ts,open,high,low,close,volume").eq("symbol", symbol).eq("timeframe", tf).eq("source", source);
      q = opts.from ? q.gte("ts", opts.from).order("ts", { ascending: true }) : q.order("ts", { ascending: false });
      const page = check(await q.range(offset, offset + 999)) as typeof rows;
      rows.push(...page);
      if (page.length < 1000 || (opts.count && rows.length >= opts.count)) break;
    }
    if (rows.length) {
      const list = opts.from ? rows : rows.slice(0, opts.count).reverse();
      return {
        time: list.map((x) => Date.parse(x.ts) / 1000), open: list.map((x) => x.open), high: list.map((x) => x.high),
        low: list.map((x) => x.low), close: list.map((x) => x.close), volume: list.map((x) => x.volume), source,
      };
    }
  }
  throw new Error(`No ${tf} candles for ${symbol}`);
}

async function sha256(obj: unknown): Promise<string> {
  const sorted = JSON.stringify(obj, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "x";
const suffix = () => Math.random().toString(36).slice(2, 7);

export async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const db = ctx.db;
  switch (name) {
    case "list_symbols":
      return check(await db.from("symbols").select("symbol,market,instrument_type,tradable,name").order("symbol"));

    case "get_candles": {
      const tf = String(input.timeframe), count = Math.max(1, Math.min(120, Number(input.count)));
      const c = await readCandles(db, String(input.symbol), tf, { count });
      return {
        source: c.source, columns: ["when_new_york", "open", "high", "low", "close", "volume"],
        rows: c.time.map((t, i) => [when(t, tf), r(c.open[i]), r(c.high[i]), r(c.low[i]), r(c.close[i]), c.volume[i]]),
      };
    }

    case "list_indicators":
      return Object.values(REGISTRY).map((d) => ({ name: d.name, label: d.label, group: d.group, defaults: d.defaults, draws: d.placement === "price" ? "on the price" : "own pane", intraday_only: d.intradayOnly }));

    case "compute_indicator": {
      const tf = String(input.timeframe) as Timeframe;
      const count = Math.max(1, Math.min(60, Number(input.count)));
      const c = await readCandles(db, String(input.symbol), tf, { count: 600 });
      const out = compute(String(input.name), c, tf, parseParams(String(input.params_json)));
      const from = Math.max(0, c.time.length - count);
      return {
        source: c.source,
        rows: c.time.slice(from).map((t, k) => ({ when_new_york: when(t, tf), close: r(c.close[from + k]), ...Object.fromEntries(Object.entries(out).map(([col, v]) => [col, r(v[from + k])])) })),
      };
    }

    case "add_indicator_to_chart": {
      const def = REGISTRY[String(input.name)];
      if (!def) throw new Error(`No indicator called ${input.name}`);
      const params = { ...def.defaults, ...parseParams(String(input.params_json)) };
      await db.from("indicator_defs").upsert(
        { name: def.name, params, code_version: `${def.name}@${def.version}`, label: String(input.label) },
        { onConflict: "name,params,code_version", ignoreDuplicates: true },
      );
      ctx.actions.push({ type: "add_indicator", name: def.name, params });
      await audit(ctx, "add_indicator_to_chart", { name: def.name, params });
      return { ok: true, note: "Added to the chart tab Ben has open." };
    }

    case "list_scan_rules":
      return Object.entries(RULES).map(([n, rule]) => ({ name: n, version: rule.version, defaults: rule.defaults }));

    case "get_scans": {
      const scans = check(await db.from("scans").select("id,label,rule,timeframe,params,symbols,enabled").order("tab").order("position")) as Record<string, unknown>[];
      const runs = check(await db.from("scan_runs").select("id,scan_id,ran_at,matches,symbols").neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(100)) as Record<string, unknown>[];
      const latest = new Map<string, Record<string, unknown>>();
      for (const run_ of runs) if (!latest.has(String(run_.scan_id))) latest.set(String(run_.scan_id), run_);
      const ids = [...latest.values()].map((x) => x.id);
      const results = ids.length ? check(await db.from("scan_results").select("run_id,symbol,direction,vals,context").in("run_id", ids)) as Record<string, unknown>[] : [];
      return scans.map((s) => {
        const l = latest.get(String(s.id));
        return { ...s, latest_run: l ? { ran_at: l.ran_at, symbols_scanned: (l.symbols as string[]).length, matches: results.filter((x) => x.run_id === l.id) } : null };
      });
    }

    case "create_scan": {
      const rule = String(input.rule);
      if (!RULES[rule]) throw new Error(`No rule called ${rule}`);
      const params = { ...RULES[rule].defaults, ...parseParams(String(input.params_json)) };
      const id = `claude_${slug(String(input.label))}_${suffix()}`;
      check(await db.from("scans").insert({
        id, label: String(input.label), rule, timeframe: String(input.timeframe), params,
        symbols: Array.isArray(input.symbols) ? input.symbols : null, context: [], tab: "custom", position: 0,
      }));
      await audit(ctx, "create_scan", { id, rule, params });
      return { id, note: "Runs tonight after the US close; shows in the Scanner's Mine tab." };
    }

    case "get_strategies": {
      const strats = check(await db.from("strategies").select("id,label,family,config,version,notes,enabled").order("position")) as Record<string, unknown>[];
      const runs = check(await db.from("backtest_runs").select("id,strategy_id,ran_at,warnings,held_back_burned").neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(300)) as Record<string, unknown>[];
      const latest = new Map<string, Record<string, unknown>>();
      for (const x of runs) if (!latest.has(String(x.strategy_id))) latest.set(String(x.strategy_id), x);
      const ids = [...latest.values()].map((x) => x.id);
      const mets = ids.length ? check(await db.from("backtest_metrics").select("run_id,kind,metrics").in("run_id", ids).neq("kind", "window")) as Record<string, unknown>[] : [];
      return strats.map((s) => {
        const l = latest.get(String(s.id));
        const pick = (kind: string) => mets.find((m) => m.run_id === l?.id && m.kind === kind)?.metrics ?? null;
        return { ...s, latest_run: l ? { ran_at: l.ran_at, build: pick("build"), held_back: pick("held_back"), warnings: l.warnings, held_back_burned: l.held_back_burned } : null };
      });
    }

    case "create_strategy": {
      const rule = String(input.signal_rule);
      if (!RULES[rule]) throw new Error(`No rule called ${rule}`);
      const config: Strategy = {
        signal_symbol: String(input.signal_symbol), signal_rule: rule, signal_params: { ...RULES[rule].defaults, ...parseParams(String(input.signal_params_json)) },
        trade_symbol: String(input.trade_symbol), target_pct: input.target_pct as number | null, target_level: input.target_level as number | null,
        stop_pct: input.stop_pct as number | null, max_bars: Math.max(1, Number(input.max_bars)), cost_pct: Number(input.cost_pct), study: Number(input.cost_pct) === 0,
        filter_symbol: (input.filter_symbol as string | null) || null, filter_max: input.filter_max as number | null, filter_min: input.filter_min as number | null,
      };
      const id = `claude_${slug(String(input.label))}_${suffix()}`;
      check(await db.from("strategies").insert({
        id, label: String(input.label), family: slug(String(input.family)), config, version: 1, start_date: START, split_date: SPLIT,
        position: 100, enabled: true, notes: String(input.notes),
      }));
      await audit(ctx, "create_strategy", { id, config });
      return { id };
    }

    case "run_backtest": {
      const st = check(await db.from("strategies").select("*").eq("id", String(input.strategy_id)).maybeSingle()) as Record<string, any> | null;
      if (!st) throw new Error(`No strategy ${input.strategy_id}`);
      const cfg = st.config as Strategy;
      const start = Date.parse(`${st.start_date}T00:00:00Z`) / 1000, split = Date.parse(`${st.split_date}T00:00:00Z`) / 1000;
      const from = new Date((start - WARM_UP_DAYS * 86400) * 1000).toISOString();
      const asOf = new Date().toISOString();
      const [sig, trd, flt] = await Promise.all([
        readCandles(db, cfg.signal_symbol, "1d", { from }), readCandles(db, cfg.trade_symbol, "1d", { from }),
        cfg.filter_symbol ? readCandles(db, cfg.filter_symbol, "1d", { from }) : Promise.resolve(undefined),
      ]);
      const res = run(cfg, sig, trd, start, undefined, flt);
      const rep = report(res, start, split);
      const configHash = await sha256(cfg);
      // The held-back years are single-use per family: seen before with other settings, they no longer test fairly.
      const familyIds = (check(await db.from("strategies").select("id").eq("family", st.family)) as { id: string }[]).map((x) => x.id);
      const earlier = check(await db.from("backtest_runs").select("config_hash").in("strategy_id", familyIds).neq("trigger", "rerun")) as { config_hash: string }[];
      const burned = earlier.some((e) => e.config_hash !== configHash);
      const iso = (t: number | null) => (t === null ? null : new Date(t * 1000).toISOString());
      const trades = res.trades.map((t, n) => ({
        n, period: t.entry_ts < split ? "build" : "held_back", signal_ts: iso(t.signal_ts), entry_ts: iso(t.entry_ts), entry_price: t.entry_price,
        exit_ts: iso(t.exit_ts), exit_price: t.exit_price, exit_reason: t.exit_reason, bars: t.bars, return_pct: t.return_pct, best_pct: t.best_pct, signal_vals: t.signal_vals,
      }));
      const runRow = check(await db.from("backtest_runs").insert({
        strategy_id: st.id, strategy_version: st.version, config: cfg, config_hash: configHash, as_of: asOf, start_date: st.start_date, split_date: st.split_date,
        code_version: ENGINE_VERSION, source: [...new Set([sig.source, trd.source])].sort().join(","),
        data_hash: await sha256({ s: [sig.time, sig.close], t: [trd.time, trd.open, trd.high, trd.low, trd.close] }),
        result_hash: await sha256({ trades, rep, skipped: res.skipped }), skipped: res.skipped, warnings: rep.warnings,
        held_back_burned: burned, trigger: "manual", notes: "Run by Claude in the app",
      }).select("id").single()) as { id: number };
      for (let i = 0; i < trades.length; i += 500) check(await db.from("backtest_trades").insert(trades.slice(i, i + 500).map((t) => ({ ...t, run_id: runRow.id }))));
      check(await db.from("backtest_metrics").insert([
        { run_id: runRow.id, period: "build", kind: "build", metrics: rep.build, position: 0 },
        { run_id: runRow.id, period: "held_back", kind: "held_back", metrics: rep.held_back, position: 1 },
        ...rep.windows.map((w, i) => {
          const { from: f, to, ...m } = w;
          return { run_id: runRow.id, period: `${f}..${to}`, kind: "window", metrics: m, position: 2 + i };
        }),
      ]));
      ctx.actions.push({ type: "open_backtest", strategy_id: st.id });
      await audit(ctx, "run_backtest", { strategy_id: st.id, run_id: runRow.id });
      return {
        run_id: runRow.id, data_source: sig.source, study: cfg.study ?? false, held_back_burned: burned, warnings: rep.warnings, skipped: res.skipped,
        build: rep.build, held_back: rep.held_back,
        windows: rep.windows.map((w) => ({ years: `${w.from}..${w.to}`, period: w.period, trades: w.trades, target_rate: w.target_rate, win_rate: w.win_rate })),
      };
    }

    case "get_pattern_lab": {
      const runs = check(await db.from("pattern_runs").select("id,question,settings,start_date,split_date,ran_at,counts,sealed_burned").neq("trigger", "rerun").order("ran_at", { ascending: false }).limit(1)) as Record<string, unknown>[];
      if (!runs.length) return { note: "The pattern lab hasn't run yet." };
      const cands = check(await db.from("pattern_candidates").select("label,status,discovery,sealed").eq("run_id", runs[0].id).order("n").limit(15));
      return { ...runs[0], patterns: cands, reminder: "Discovery numbers saw the future: never present them as win rates." };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}
