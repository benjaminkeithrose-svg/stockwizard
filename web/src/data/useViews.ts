// Chart pages: kept in this browser for opening offline, saved to the
// database shortly after each change, read back on start. Same pattern as
// useWorkspaces.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Store } from "./store";
import { keepUnsaved, readUnsaved } from "./unsaved";
import { ChartView, newId } from "./model";
import type { SyncState } from "./useWorkspaces";

const SAVE_DELAY = 600;

export function useViews(store: Store, userId: string) {
  const cacheKey = `stockwizard.views.${userId}`;
  const activeKey = `stockwizard.activeView.${userId}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(cacheKey) ?? "[]") as ChartView[]; } catch { return []; } };
  const write = (l: ChartView[]) => { try { localStorage.setItem(cacheKey, JSON.stringify(l)); } catch { /* fine */ } };
  const [list, setList] = useState<ChartView[]>(read);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(activeKey));
  const [sync, setSync] = useState<SyncState>("saved");
  const [loaded, setLoaded] = useState(false);
  const unsavedKey = `stockwizard.views.unsaved.${userId}`;
  const pending = useRef(readUnsaved<ChartView>(unsavedKey));
  const keepPending = () => keepUnsaved(unsavedKey, pending.current);
  const timer = useRef<number | undefined>(undefined);
  const listRef = useRef(list);
  listRef.current = list;

  const flush = useCallback(async () => {
    if (!pending.current.size) return;
    setSync("saving");
    for (const [id, v] of [...pending.current]) {
      try {
        await store.saveView(v);
        if (pending.current.get(id) === v) { pending.current.delete(id); keepPending(); }
      } catch {
        setSync(navigator.onLine ? "error" : "offline");
        return;
      }
    }
    setSync("saved");
  }, [store]);

  const commit = useCallback((next: ChartView[], changed: ChartView[]) => {
    setList(next);
    write(next);
    changed.forEach((v) => pending.current.set(v.id, v));
    keepPending();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    store.views().then((remote) => {
      if (!live) return;
      const merged = remote.map((r) => pending.current.get(r.id) ?? r);
      for (const p of pending.current.values()) if (!merged.some((m) => m.id === p.id)) merged.push(p);
      merged.sort((a, b) => a.position - b.position);
      setList(merged);
      write(merged);
      setLoaded(true);
      flush();
    }).catch(() => { setSync("offline"); setLoaded(true); });
    const online = () => flush();
    window.addEventListener("online", online);
    return () => { live = false; window.removeEventListener("online", online); };
  }, [store, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (activeId) try { localStorage.setItem(activeKey, activeId); } catch { /* fine */ } }, [activeId, activeKey]);

  const active = list.find((v) => v.id === activeId) ?? list[0] ?? null;

  const update = useCallback((v: ChartView) => commit(listRef.current.map((x) => (x.id === v.id ? v : x)), [v]), [commit]);

  const add = useCallback((name: string) => {
    const v: ChartView = { id: newId(), name, position: listRef.current.length, cards: [] };
    commit([...listRef.current, v], [v]);
    setActiveId(v.id);
    return v;
  }, [commit]);

  const duplicate = useCallback((v: ChartView) => {
    const copy: ChartView = { ...structuredClone(v), id: newId(), name: `${v.name} copy`, position: listRef.current.length,
      cards: v.cards.map((c) => ({ ...c, id: newId() })), updated_at: undefined };
    commit([...listRef.current, copy], [copy]);
    setActiveId(copy.id);
    return copy;
  }, [commit]);

  const remove = useCallback(async (v: ChartView) => {
    pending.current.delete(v.id);
    keepPending();
    const next = listRef.current.filter((x) => x.id !== v.id);
    setList(next);
    write(next);
    if (activeId === v.id) setActiveId(next[0]?.id ?? null);
    try { await store.deleteView(v.id); } catch { setSync("error"); }
  }, [store, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { list, active, setActiveId, update, add, duplicate, remove, sync, loaded };
}
