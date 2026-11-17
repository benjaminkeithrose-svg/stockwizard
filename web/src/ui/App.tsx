// The app shell: header (back, title, home, ⋯ menu), sign-in, and the screens.
// Back goes up one level: a watchlist → Watchlists → Chart.

import { useEffect, useMemo, useState } from "react";
import { DemoStore, Store, SupabaseStore, User } from "../data/store";
import type { SymbolInfo, Watchlist } from "../data/model";
import { useWorkspaces } from "../data/useWorkspaces";
import ChartScreen from "./ChartScreen";
import SafetyScreen from "./Safety";
import HelpScreen from "./Help";
import AnalysisScreen from "./Analysis";
import { OptionBacktestScreen } from "./OptionBacktests";
import { structureLabel } from "../data/options";
import { Back, Flask, Grid, Home, List, Radar, Spark } from "./icons";
import ClaudePanel from "./ClaudePanel";
import { indicator } from "../data/model";
import { BacktestScreen, BacktestsScreen } from "./Backtests";
import PagesScreen from "./Pages";
import { useViews } from "../data/useViews";
import { useFavourites, usePositions } from "../data/usePositions";
import { cameBackFresh, checkForUpdate, getLatestVersion } from "../update";
import ScannerScreen from "./Scanner";
import type { Timeframe } from "../data/candles";
import { MoreMenu } from "./parts";
import SignIn from "./SignIn";
import { useWatchlists, WatchlistScreen, WatchlistsScreen } from "./Watchlists";
import { APP_BUILD } from "../config";

type Screen = { name: "chart" } | { name: "scanner" } | { name: "pages" } | { name: "card" } | { name: "backtests" } | { name: "backtest"; id: string } | { name: "watchlists" } | { name: "safety" } | { name: "help" } | { name: "analysis"; id: string } | { name: "optbacktest"; id: string } | { name: "watchlist"; list: Watchlist };

export function makeStore(): Store {
  return new URLSearchParams(location.search).has("demo") ? new DemoStore() : new SupabaseStore();
}

export default function App({ store }: { store: Store }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    store.currentUser().then(setUser).catch(() => setUser(null));
    return store.onUserChange(setUser);
  }, [store]);

  if (user === undefined) return <div className="app"><Header title="Stock Wizard" /></div>;
  if (!user) return <div className="app"><Header title="Stock Wizard" /><SignIn store={store} /></div>;
  return <SignedIn store={store} user={user} key={user.id} />;
}

function Header(props: { title: string; sub?: string; onBack?: () => void; onHome?: () => void; onScanner?: () => void; onPages?: () => void; onBacktests?: () => void; onClaude?: () => void; menu?: React.ReactNode }) {
  return (
    <header>
      {props.onBack
        ? <button className="back" aria-label="Back" onClick={props.onBack}><Back /></button>
        : <span className="back blank" />}
      <div className="hdt">
        <h1>{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </div>
      {props.onClaude && <button className="menubtn" aria-label="Claude" onClick={props.onClaude}><Spark /></button>}
      {props.onPages && <button className="menubtn" aria-label="Chart pages" onClick={props.onPages}><Grid /></button>}
      {props.onScanner && <button className="menubtn" aria-label="Scanner" onClick={props.onScanner}><Radar /></button>}
      {props.onBacktests && <button className="menubtn" aria-label="Backtests" onClick={props.onBacktests}><Flask /></button>}
      {props.onHome && <button className="menubtn" aria-label="Home" onClick={props.onHome}><Home /></button>}
      {props.menu}
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
  const [screen, setScreen] = useState<Screen>({ name: "chart" });
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
  useEffect(() => {
    if (cameBackFresh()) setToast(`Up to date: build ${APP_BUILD}`);
    checkForUpdate();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const back = screen.name === "watchlist" ? () => setScreen({ name: "watchlists" })
    : screen.name === "card" ? () => setScreen({ name: "pages" })
    : screen.name === "backtest" || screen.name === "optbacktest" ? () => setScreen({ name: "backtests" })
    : screen.name === "backtests" ? () => setScreen({ name: "chart" })
    : screen.name === "watchlists" || screen.name === "scanner" || screen.name === "pages" || screen.name === "safety" || screen.name === "analysis" || screen.name === "help" ? () => setScreen({ name: "chart" }) : undefined;
  const title = screen.name === "chart" ? "Stock Wizard" : screen.name === "scanner" ? "Scanner"
    : screen.name === "pages" ? "Chart pages" : screen.name === "backtests" ? "Backtests"
    : screen.name === "backtest" ? (strategyLabels[screen.id] ?? "Backtest") : screen.name === "card" ? (ws.active?.name ?? "Chart")
    : screen.name === "watchlists" ? "Watchlists" : screen.name === "optbacktest" ? "Option backtest" : screen.name === "safety" ? "Safety" : screen.name === "help" ? "Help" : screen.name === "analysis" ? (analysing ? `${structureLabel(analysing.structure)} · ${analysing.symbol}` : "Analysis") : screen.list.name;
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

  const menu = (
    <MoreMenu label="More" items={[
      { label: "Watchlists", icon: <List />, onPick: () => setScreen({ name: "watchlists" }) },
      { label: "Safety and orders", onPick: () => setScreen({ name: "safety" }) },
      { label: "Help", onPick: () => setScreen({ name: "help" }) },
      { label: "-", onPick: () => {} },
      { label: "Get latest version", onPick: () => { setToast("Getting the latest version…"); getLatestVersion(); } },
      { label: `Sign out of ${store.demo ? "demo" : user.email}`, onPick: () => store.signOut() },
      { label: `Build ${APP_BUILD}`, onPick: () => {} },
    ]} />
  );

  return (
    <div className="app">
      <Header title={title} sub={sub} onBack={back} onHome={screen.name === "chart" ? undefined : () => setScreen({ name: "chart" })}
        onScanner={screen.name === "chart" ? () => setScreen({ name: "scanner" }) : undefined}
        onPages={screen.name === "chart" ? () => setScreen({ name: "pages" }) : undefined}
        onBacktests={screen.name === "chart" ? () => setScreen({ name: "backtests" }) : undefined}
        onClaude={() => setClaudeOpen(!claudeOpen)} menu={menu} />
      {claudeOpen && (
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
      {screen.name === "help" && <HelpScreen />}
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
