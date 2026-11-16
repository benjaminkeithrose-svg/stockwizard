// Watchlists: a list of lists, and one list's symbols. Tapping a symbol opens
// it in the current chart tab.

import { useEffect, useState } from "react";
import type { Store } from "../data/store";
import type { SymbolInfo, Watchlist } from "../data/model";
import { Bin, Plus } from "./icons";
import { AskText, ConfirmDelete, MoreMenu } from "./parts";
import { SymbolSearch } from "./sheets";

export function useWatchlists(store: Store) {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = () => store.watchlists().then(setLists).catch((e) => setError(String(e.message ?? e)));
  useEffect(() => { reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (w: Watchlist) => {
    try {
      const saved = await store.saveWatchlist(w);
      setLists((l) => [...l.filter((x) => x.id !== w.id && x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const remove = async (w: Watchlist) => {
    try {
      await store.deleteWatchlist(w.id);
      setLists((l) => l.filter((x) => x.id !== w.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { lists, save, remove, error };
}

type WL = ReturnType<typeof useWatchlists>;

export function WatchlistsScreen(props: { wl: WL; onOpen: (w: Watchlist) => void }) {
  const { wl } = props;
  const [naming, setNaming] = useState<Watchlist | "new" | null>(null);
  const [deleting, setDeleting] = useState<Watchlist | null>(null);
  return (
    <div className="list">
      <button className="big" style={{ marginBottom: 12 }} onClick={() => setNaming("new")}>New watchlist</button>
      {wl.error && <div className="msg err">{wl.error}</div>}
      {wl.lists.map((w) => (
        <div key={w.id} className="card">
          <button className="cmain" onClick={() => props.onOpen(w)}>
            <div className="t">{w.name}</div>
            <div className="meta">{w.symbols.length} symbol{w.symbols.length === 1 ? "" : "s"}{w.is_universe ? " · scanner universe" : ""}</div>
          </button>
          <MoreMenu className="icon" label={`More for ${w.name}`} items={[
            { label: "Rename", onPick: () => setNaming(w) },
            { label: "Duplicate", onPick: () => setNaming({ ...w, id: "", name: `${w.name} copy`, is_universe: false }) },
            { label: "-", onPick: () => {} },
            { label: "Delete", danger: true, onPick: () => setDeleting(w) },
          ]} />
        </div>
      ))}
      {!wl.lists.length && <p className="empty">No watchlists.</p>}
      {naming && (
        <AskText title={naming === "new" ? "New watchlist" : naming.id === "" ? "Duplicate watchlist" : "Rename watchlist"}
          label="Name" value={naming === "new" ? "" : naming.name} onClose={() => setNaming(null)}
          onDone={async (name) => {
            const saved = await wl.save(naming === "new" ? { id: "", name, is_universe: false, symbols: [] } : { ...naming, name });
            if (saved && (naming === "new" || naming.id === "")) props.onOpen(saved);
          }} />
      )}
      {deleting && (
        <ConfirmDelete what={`the watchlist “${deleting.name}”`}
          detail={`It holds ${deleting.symbols.length} symbol${deleting.symbols.length === 1 ? "" : "s"}. The symbols and their candles stay.`}
          onCancel={() => setDeleting(null)} onDelete={() => { wl.remove(deleting); setDeleting(null); }} />
      )}
    </div>
  );
}

export function WatchlistScreen(props: { wl: WL; list: Watchlist; symbols: SymbolInfo[]; onPick: (s: string) => void }) {
  const [adding, setAdding] = useState(false);
  const list = props.wl.lists.find((l) => l.id === props.list.id) ?? props.list;
  const info = (s: string) => props.symbols.find((x) => x.symbol === s);
  return (
    <div className="list">
      <button className="big" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={() => setAdding(true)}><Plus />Add symbol</button>
      {props.wl.error && <div className="msg err">{props.wl.error}</div>}
      {list.symbols.map((s) => (
        <div key={s} className="card">
          <button className="cmain" onClick={() => props.onPick(s)}>
            <div className="t">{s}</div>
            <div className="meta">{[info(s)?.name, info(s)?.market].filter(Boolean).join(" · ")}</div>
          </button>
          <button className="icon bin" aria-label={`Remove ${s} from ${list.name}`}
            onClick={() => props.wl.save({ ...list, symbols: list.symbols.filter((x) => x !== s) })}><Bin /></button>
        </div>
      ))}
      {!list.symbols.length && <p className="empty">No symbols.</p>}
      {adding && (
        <SymbolSearch symbols={props.symbols.filter((s) => !list.symbols.includes(s.symbol))} onClose={() => setAdding(false)}
          onPick={(s) => { props.wl.save({ ...list, symbols: [...list.symbols, s] }); setAdding(false); }} />
      )}
    </div>
  );
}
