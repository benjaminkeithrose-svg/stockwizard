// Option structures drawn on the charts, and the favourites row. Kept in this
// browser so they open offline, saved to the database shortly after each
// change, read back on start. Same pattern as useViews.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Store } from "./store";
import { DEFAULT_FAVOURITES, Favourite, MAX_FAVOURITES } from "./model";
import type { OptionPosition } from "./options";
import type { SyncState } from "./useWorkspaces";

const SAVE_DELAY = 600;

function cached<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function keep(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* fine */ } }

export function usePositions(store: Store, userId: string) {
  const cacheKey = `stockwizard.positions.${userId}`;
  const pendingKey = `stockwizard.positions.unsaved.${userId}`;
  const [list, setList] = useState<OptionPosition[]>(() => cached(cacheKey, []));
  const [sync, setSync] = useState<SyncState>("saved");
  // Changes not yet saved are kept on the device too, so closing the app straight after a change loses nothing.
  const pending = useRef(new Map<string, OptionPosition>(cached<OptionPosition[]>(pendingKey, []).map((p) => [p.id, p])));
  const keepPending = () => keep(pendingKey, [...pending.current.values()]);
  const timer = useRef<number | undefined>(undefined);
  const listRef = useRef(list);
  listRef.current = list;

  const flush = useCallback(async () => {
    if (!pending.current.size) return;
    setSync("saving");
    for (const [id, p] of [...pending.current]) {
      try {
        await store.savePosition(p);
        if (pending.current.get(id) === p) { pending.current.delete(id); keepPending(); }
      } catch {
        setSync(navigator.onLine ? "error" : "offline");
        return;
      }
    }
    setSync("saved");
  }, [store]);

  const commit = useCallback((next: OptionPosition[], changed: OptionPosition) => {
    const shown = next.filter((p) => p.status !== "closed");
    setList(shown);
    keep(cacheKey, shown);
    pending.current.set(changed.id, changed);
    keepPending();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush, cacheKey]);

  useEffect(() => {
    let live = true;
    store.positions().then((remote) => {
      if (!live) return;
      const merged = remote.map((r) => pending.current.get(r.id) ?? r);
      for (const p of pending.current.values()) if (!merged.some((m) => m.id === p.id)) merged.push(p);
      const shown = merged.filter((p) => p.status !== "closed");
      setList(shown);
      keep(cacheKey, shown);
      flush();
    }).catch(() => setSync("offline"));
    const online = () => flush();
    window.addEventListener("online", online);
    return () => { live = false; window.removeEventListener("online", online); };
  }, [store, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback((p: OptionPosition) => {
    const cur = listRef.current;
    commit(cur.some((x) => x.id === p.id) ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p], p);
  }, [commit]);

  const remove = useCallback(async (p: OptionPosition) => {
    pending.current.delete(p.id);
    keepPending();
    const next = listRef.current.filter((x) => x.id !== p.id);
    setList(next);
    keep(cacheKey, next);
    try { await store.deletePosition(p.id); } catch { setSync("error"); }
  }, [store, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const forSymbol = useCallback((symbol: string) => list.filter((p) => p.symbol === symbol), [list]);

  return { list, forSymbol, save, remove, sync };
}

export function useFavourites(store: Store, userId: string) {
  const cacheKey = `stockwizard.favourites.${userId}`;
  const [list, setList] = useState<Favourite[]>(() => cached(cacheKey, DEFAULT_FAVOURITES));
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    store.settings().then((s) => {
      if (!live || dirty.current) return;
      setList(s.favourites);
      keep(cacheKey, s.favourites);
    }).catch(() => { /* offline: the cached row stands */ });
    return () => { live = false; };
  }, [store, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((next: Favourite[]) => {
    const capped = next.slice(0, MAX_FAVOURITES);
    dirty.current = true;
    setList(capped);
    keep(cacheKey, capped);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      store.saveSettings({ favourites: capped }).then(() => { dirty.current = false; }).catch(() => { /* kept on the device; saved with the next change */ });
    }, SAVE_DELAY);
  }, [store, cacheKey]);

  return { list, set };
}
