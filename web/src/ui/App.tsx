// The app shell: sign-in, the header and the screens. The header is the same on every
// screen (Ben, 18 Nov 2026, cues from Financial Vault): home, back, the title, Today,
// Claude and Menu. Menu is one full-screen list of every screen (Navigation.tsx); the path
// bar under the header shows the screens you came through, and back goes up that path.

import { useEffect, useMemo, useState } from "react";
import { ARRIVED_BY, DemoStore, Store, SupabaseStore, User } from "../data/store";
import type { SymbolInfo, Watchlist } from "../data/model";
import { useWorkspaces } from "../data/useWorkspaces";
import ChartScreen from "./ChartScreen";
import SafetyScreen from "./Safety";
import HelpScreen from "./Help";
import TodayScreen from "./Today";
import AnalysisScreen from "./Analysis";
import { OptionBacktestScreen } from "./OptionBacktests";
import { structureLabel } from "../data/options";
import { Back, Home, MenuIcon, Spark } from "./icons";
import { Crumb, FullMenu, MenuGroup, PathBar } from "./Navigation";
import ClaudePanel from "./ClaudePanel";
import { indicator } from "../data/model";
import { BacktestScreen, BacktestsScreen } from "./Backtests";
import PagesScreen from "./Pages";
import { useViews } from "../data/useViews";
import { useFavourites, usePositions } from "../data/usePositions";
import { cameBackFresh, checkForUpdate, getLatestVersion } from "../update";
import ScannerScreen from "./Scanner";
import type { Timeframe } from "../data/candles";
import SignIn, { SetPassword } from "./SignIn";
import BotKeyScreen from "./BotKey";
import { useWatchlists, WatchlistScreen, WatchlistsScreen } from "./Watchlists";
import { APP_BUILD } from "../config";

type Screen = { name: "chart" } | { name: "scanner" } | { name: "pages" } | { name: "card" } | { name: "backtests" } | { name: "backtest"; id: string } | { name: "watchlists" } | { name: "safety" } | { name: "botkey" } | { name: "help" } | { name: "today" } | { name: "analysis"; id: string } | { name: "optbacktest"; id: string } | { name: "watchlist"; list: Watchlist };

/** One screen's identity, for the path and the menu: its name, and which backtest, structure or list. */
function screenKey(s: Screen): string {
  return "id" in s ? `${s.name}:${s.id}` : s.name === "watchlist" ? `watchlist:${s.list.id}` : s.name;
}

export function makeStore(): Store {
  return new URLSearchParams(location.search).has("demo") ? new DemoStore() : new SupabaseStore();
}

export default function App({ store }: { store: Store }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [passwordSet, setPasswordSet] = useState(false);
  useEffect(() => {
    store.currentUser().then(setUser).catch(() => setUser(null));
    return store.onUserChange(setUser);
  }, [store]);

  if (user === undefined) return <div className="app"><Header title="Stock Wizard" /></div>;
  if (!user) return <div className="app"><Header title="Stock Wizard" /><SignIn store={store} /></div>;
  // Arrived from an invitation or a password-reset email: choose a password first.
  if (ARRIVED_BY && !passwordSet) return <div className="app"><Header title="Stock Wizard" /><SetPassword store={store} why={ARRIVED_BY} onDone={() => setPasswordSet(true)} /></div>;
  return <SignedIn store={store} user={user} key={user.id} />;
}

/** The same header on every screen: home and back on the left, then the title, then Today, Claude and Menu. */
function Header(props: { title: string; sub?: string; onBack?: () => void; onHome?: () => void; onClaude?: () => void; onToday?: () => void; onMenu?: () => void }) {
  return (
    <header>
      {props.onHome && <button className="back" aria-label="Home" onClick={props.onHome}><Home /></button>}
      {props.onBack
        ? <button className="back" aria-label="Back" onClick={props.onBack}><Back /></button>
        : !props.onHome && <span className="back blank" />}
      <div className="hdt">
        <h1>{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </div>
      {props.onToday && <button className="menubtn word" onClick={props.onToday}>Today</button>}
      {props.onClaude && <button className="menubtn" aria-label="Claude" onClick={props.onClaude}><Spark /></button>}
      {props.onMenu && <button className="menubtn" aria-label="Menu" onClick={props.onMenu}><MenuIcon /></button>}
    </header>
  );
}

function SignedIn({ store, user }: { store: Store; user: User }) {
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  useEffect(() => { store.symbols().then(setSymbols).catch(() => setSymbols([])); }, [store]);
  const symbolsRef = useMemo(() => ({ current: symbols }), []); // eslint-disable-line react-hooks/exhaustive-deps
  symbolsRef.current = symbols;
  const firstSymbol = () => symbolsRef.current.find((s) => s.symbol === "SPY")?.symbol ?? symbolsRef.current[0]?.symbol ?? (store.demo ? "DEMO" : "SPY");

  const ws = useWorkspaces(store, user.id, firstSymbol);
  const wl = useWatchlists(store);
  const views = useViews(store, user.id);
  const pos = usePositions(store, user.id);
  const fav = useFavourites(store, user.id);
  const [strategyLabels, setStrategyLabels] = useState<Record<string, string>>({});
  useEffect(() => { store.strategies().then((s) => setStrategyLabels(Object.fromEntries(s.map((x) => [x.id, x.label])))).catch(() => {}); }, [store]);
  const [screen, setScreenNow] = useState<Screen>({ name: "chart" });
  // The path you came down from the chart (the home screen), for the path bar and for back.
  const [trail, setTrail] = useState<Screen[]>([]);
  const go = (next: Screen, fresh = false) => {
    if (next.name === "chart") setTrail([]);
    else if (fresh) setTrail([next]);   // the menu starts a new path
    else setTrail((t) => {
      const i = t.findIndex((s) => screenKey(s) === screenKey(next));
      return i >= 0 ? t.slice(0, i + 1) : [...t, next];   // going back to a screen on the path cuts it there
    });
    setScreenNow(next);
  };
  const setScreen = (s: Screen) => go(s);
  const [adjust, setAdjust] = useState<string | null>(null);
  // "Adjust on the chart" is read once, when the chart opens; forget it after that.
  useEffect(() => {
    if (!adjust || screen.name !== "chart") return;
    const t = setTimeout(() => setAdjust(null), 0);
    return () => clearTimeout(t);
  }, [adjust, screen.name]);
  const analysing = screen.name === "analysis" ? pos.list.find((p) => p.id === screen.id) ?? null : null;
  const [toast, setToast] = useState<string | null>(null);
  const [claudeOpen, setClaudeOpen] = useState(false);
  // Claude costs Ben's Anthropic account: the button shows only for people it's switched on for.
  const [claudeOk, setClaudeOk] = useState(false);
  useEffect(() => { store.claudeAllowed().then(setClaudeOk).catch(() => setClaudeOk(false)); }, [store]);
  useEffect(() => {
    if (cameBackFresh()) setToast(`Up to date: build ${APP_BUILD}`);
    checkForUpdate();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Back goes up the path you came down; with no path (opened from somewhere unusual), up the app's structure.
  const structuralParent = (s: Screen): Screen | null => s.name === "chart" ? null
    : s.name === "watchlist" ? { name: "watchlists" } : s.name === "card" ? { name: "pages" }
    : s.name === "backtest" || s.name === "optbacktest" ? { name: "backtests" } : { name: "chart" };
  const parent = trail.length >= 2 ? trail[trail.length - 2] : structuralParent(screen);
  const back = parent ? () => go(parent) : undefined;
  const titleOf = (s: Screen): string => s.name === "chart" ? "Stock Wizard" : s.name === "scanner" ? "Scanner"
    : s.name === "pages" ? "Chart pages" : s.name === "backtests" ? "Backtests"
    : s.name === "backtest" ? (strategyLabels[s.id] ?? "Backtest") : s.name === "card" ? (ws.active?.name ?? "Chart")
    : s.name === "watchlists" ? "Watchlists" : s.name === "optbacktest" ? "Option backtest" : s.name === "safety" ? "Safety and orders" : s.name === "botkey" ? "Bot key" : s.name === "help" ? "Help" : s.name === "today" ? "Today"
    : s.name === "analysis" ? (() => { const p = pos.list.find((x) => x.id === s.id); return p ? `${structureLabel(p.structure)} · ${p.symbol}` : "Analysis"; })()
    : s.list.name;
  const title = titleOf(screen);
  const crumbs: Crumb[] = [{ name: "chart" } as Screen, ...trail].map((s) => ({ key: screenKey(s), title: titleOf(s), onPick: () => go(s) }));
  // Open a symbol and timeframe in the current tab; a tab still on its automatic name follows.
  const openOnChart = (s: string, tf?: Timeframe) => {
    const w = ws.active;
    if (w) {
      const timeframe = tf ?? w.timeframe;
      ws.update({ ...w, symbol: s, timeframe, name: w.name === `${w.symbol} ${w.timeframe}` ? `${s} ${timeframe}` : w.name });
    }
    setScreen({ name: "chart" });
  };
  const sub = screen.name === "chart"
    ? (store.demo ? "Made-up data, kept in this browser" : user.email)
    : screen.name === "watchlist" ? `${screen.list.symbols.length} symbols`
    : screen.name === "card" ? views.active?.name : undefined;

  // Every screen, grouped, in the full-screen menu (picks there start a new path).
  const [menuOpen, setMenuOpen] = useState(false);
  const entry = (s: Screen, label = titleOf(s)) => ({ key: screenKey(s), label, onPick: () => go(s, true) });
  const groups: MenuGroup[] = [
    { label: "Charts", entries: [entry({ name: "chart" }, "Chart"), entry({ name: "today" }), entry({ name: "pages" })] },
    { label: "Research", entries: [entry({ name: "scanner" }), entry({ name: "backtests" }), entry({ name: "watchlists" })] },
    { label: "Trading", entries: [entry({ name: "safety" }), entry({ name: "botkey" })] },
    { label: "Settings and help", entries: [
      entry({ name: "help" }),
      { key: "update", label: "Get latest version", onPick: () => { setToast("Getting the latest version…"); getLatestVersion(); } },
      { key: "signout", label: `Sign out of ${store.demo ? "demo" : user.email}`, onPick: () => store.signOut() },
    ] },
  ];

  return (
    <div className="app">
      <Header title={title} sub={sub} onBack={back} onHome={screen.name === "chart" ? undefined : () => go({ name: "chart" })}
        onToday={screen.name === "today" ? undefined : () => go({ name: "today" }, true)}
        onClaude={claudeOk ? () => setClaudeOpen(!claudeOpen) : undefined} onMenu={() => setMenuOpen(true)} />
      <PathBar crumbs={crumbs} />
      {menuOpen && <FullMenu groups={groups} current={screenKey(screen)} onClose={() => setMenuOpen(false)}
        foot={<p className="hint" style={{ marginTop: 18 }}>Build {APP_BUILD}</p>} />}
      {claudeOpen && claudeOk && (
        <ClaudePanel store={store} userId={user.id} onClose={() => setClaudeOpen(false)}
          onOpenBacktest={(id) => { setScreen({ name: "backtest", id }); if (window.innerWidth < 720) setClaudeOpen(false); }}
          onAction={(a) => {
            const w = ws.active;
            if (a.type === "add_indicator" && w) {
              ws.update({ ...w, indicators: [...w.indicators, indicator(a.name, a.params)] });
              setToast("Claude put an indicator on your chart");
            }
          }} />
      )}
      {screen.name === "backtests" && <BacktestsScreen store={store} onOpen={(id) => setScreen({ name: "backtest", id })} onOpenOption={(id) => setScreen({ name: "optbacktest", id })} />
      }
      {screen.name === "optbacktest" && <OptionBacktestScreen store={store} id={screen.id} />}
      {screen.name === "backtest" && <BacktestScreen store={store} id={screen.id} />}
      {screen.name === "pages" && (
        <PagesScreen store={store} views={views} ws={ws} positions={pos.list} onOpen={(id) => { ws.setActiveId(id); setScreen({ name: "card" }); }} />
      )}
      {screen.name === "card" && <ChartScreen store={store} ws={ws} pos={pos} fav={fav} symbols={symbols} firstSymbol={firstSymbol} single
        onAnalyse={(id) => { setAdjust(null); setScreen({ name: "analysis", id }); }} adjust={adjust} />}
      {screen.name === "scanner" && <ScannerScreen store={store} onOpen={openOnChart} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {screen.name === "chart" && <ChartScreen store={store} ws={ws} pos={pos} fav={fav} symbols={symbols} firstSymbol={firstSymbol}
        onAnalyse={(id) => { setAdjust(null); setScreen({ name: "analysis", id }); }} adjust={adjust} />}
      {screen.name === "safety" && <SafetyScreen store={store} />}
      {screen.name === "botkey" && <BotKeyScreen store={store} />}
      {screen.name === "help" && <HelpScreen />}
      {screen.name === "today" && <TodayScreen store={store} onSafety={() => setScreen({ name: "safety" })} />}
      {screen.name === "analysis" && (analysing
        ? <AnalysisScreen store={store} position={analysing} others={pos.list.filter((p) => p.symbol === analysing.symbol)}
            onAdjust={() => { setAdjust(analysing.id); setScreen({ name: "chart" }); }} />
        : <div className="list"><p className="empty">That structure has been deleted.</p></div>)}
      {screen.name === "watchlists" && <WatchlistsScreen wl={wl} onOpen={(list) => setScreen({ name: "watchlist", list })} />}
      {screen.name === "watchlist" && (
        <WatchlistScreen wl={wl} list={screen.list} symbols={symbols}
          onPick={(s) => openOnChart(s)} />
      )}
    </div>
  );
}
