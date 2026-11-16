// Where the app's data lives. SupabaseStore is the real one; DemoStore keeps
// everything in this browser with made-up candles (used by the tests, and by
// opening the app with ?demo in the address).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Candles, emptyCandles, madeUpCandles, Timeframe } from "./candles";
import { SymbolInfo, Watchlist, Workspace } from "./model";
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
}

/** Everything in this browser's storage, made-up candles. Never touches the network. */
export class DemoStore implements Store {
  readonly demo = true;
  private key = "stockwizard.demo";
  private user: User | null = { id: "demo", email: "demo" };
  private listeners = new Set<(u: User | null) => void>();

  private load(): { workspaces: Workspace[]; watchlists: Watchlist[] } {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) return JSON.parse(raw);
    } catch {
      /* storage blocked: start empty */
    }
    return { workspaces: [], watchlists: [{ id: "demo-1", name: "Made-up list", is_universe: false, symbols: ["DEMO", "TEST"] }] };
  }

  private save(d: { workspaces: Workspace[]; watchlists: Watchlist[] }) {
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
}
