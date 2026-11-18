// The symbols automated trading touches (strategies switched on, positions open or working),
// refreshed each minute, for the Auto marker on chart tabs and page cards (Ben, 19 Nov 2026).

import { useEffect, useState } from "react";
import type { Store } from "./store";
import { autoSymbols } from "./trading";

export function useAutoSymbols(store: Store): Set<string> {
  const [syms, setSyms] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = () => Promise.all([store.botStrategies(), store.paperOrders()])
      .then(([s, o]) => setSyms(autoSymbols(s, o.filter((x) => x.strategy_id))))
      .catch(() => { /* not signed in, or offline: no markers */ });
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [store]);
  return syms;
}
