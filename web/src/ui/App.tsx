// The app shell: header (back, title, home, ⋯ menu), sign-in, and the screens.
// Back goes up one level: a watchlist → Watchlists → Chart.

import { useEffect, useMemo, useState } from "react";
import { DemoStore, Store, SupabaseStore, User } from "../data/store";
import type { SymbolInfo, Watchlist } from "../data/model";
import { useWorkspaces } from "../data/useWorkspaces";
import ChartScreen from "./ChartScreen";
import { Back, Home, List, Radar } from "./icons";
import ScannerScreen from "./Scanner";
import type { Timeframe } from "../data/candles";
import { MoreMenu } from "./parts";
import SignIn from "./SignIn";
import { useWatchlists, WatchlistScreen, WatchlistsScreen } from "./Watchlists";
import { APP_BUILD } from "../config";

type Screen = { name: "chart" } | { name: "scanner" } | { name: "watchlists" } | { name: "watchlist"; list: Watchlist };

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

function Header(props: { title: string; sub?: string; onBack?: () => void; onHome?: () => void; onScanner?: () => void; menu?: React.ReactNode }) {
  return (
    <header>
      {props.onBack
        ? <button className="back" aria-label="Back" onClick={props.onBack}><Back /></button>
        : <span className="back blank" />}
      <div className="hdt">
        <h1>{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </div>
      {props.onScanner && <button className="menubtn" aria-label="Scanner" onClick={props.onScanner}><Radar /></button>}
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
  const [screen, setScreen] = useState<Screen>({ name: "chart" });

  const back = screen.name === "watchlist" ? () => setScreen({ name: "watchlists" })
    : screen.name === "watchlists" || screen.name === "scanner" ? () => setScreen({ name: "chart" }) : undefined;
  const title = screen.name === "chart" ? "Stock Wizard" : screen.name === "scanner" ? "Scanner"
    : screen.name === "watchlists" ? "Watchlists" : screen.list.name;
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
    : screen.name === "watchlist" ? `${screen.list.symbols.length} symbols` : undefined;

  const menu = (
    <MoreMenu label="More" items={[
      { label: "Watchlists", icon: <List />, onPick: () => setScreen({ name: "watchlists" }) },
      { label: "-", onPick: () => {} },
      { label: `Sign out of ${store.demo ? "demo" : user.email}`, onPick: () => store.signOut() },
      { label: `Build ${APP_BUILD}`, onPick: () => {} },
    ]} />
  );

  return (
    <div className="app">
      <Header title={title} sub={sub} onBack={back} onHome={screen.name === "chart" ? undefined : () => setScreen({ name: "chart" })}
        onScanner={screen.name === "chart" ? () => setScreen({ name: "scanner" }) : undefined} menu={menu} />
      {screen.name === "scanner" && <ScannerScreen store={store} onOpen={openOnChart} />}
      {screen.name === "chart" && <ChartScreen store={store} ws={ws} symbols={symbols} firstSymbol={firstSymbol} />}
      {screen.name === "watchlists" && <WatchlistsScreen wl={wl} onOpen={(list) => setScreen({ name: "watchlist", list })} />}
      {screen.name === "watchlist" && (
        <WatchlistScreen wl={wl} list={screen.list} symbols={symbols}
          onPick={(s) => openOnChart(s)} />
      )}
    </div>
  );
}
