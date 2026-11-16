// Workspace tabs: kept in this browser for opening offline, saved to the
// database shortly after each change, and read back from it on every start so
// another device's changes show up.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Store } from "./store";
import { duplicateWorkspace, newWorkspace, Workspace } from "./model";
import type { Timeframe } from "./candles";

const SAVE_DELAY = 600;

function readCache(key: string): Workspace[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
function writeCache(key: string, list: Workspace[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the database still has them */
  }
}

export type SyncState = "saved" | "saving" | "offline" | "error";

export function useWorkspaces(store: Store, userId: string, firstSymbol: () => string) {
  const cacheKey = `stockwizard.ws.${userId}`;
  const activeKey = `stockwizard.active.${userId}`;
  const [list, setList] = useState<Workspace[]>(() => readCache(cacheKey));
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(activeKey));
  const [sync, setSync] = useState<SyncState>("saved");
  const [loaded, setLoaded] = useState(false);
  const pending = useRef(new Map<string, Workspace>());
  const timer = useRef<number | undefined>(undefined);
  const listRef = useRef(list);
  listRef.current = list;

  const flush = useCallback(async () => {
    if (!pending.current.size) return;
    setSync("saving");
    for (const [id, w] of [...pending.current]) {
      try {
        await store.saveWorkspace(w);
        if (pending.current.get(id) === w) pending.current.delete(id);
      } catch {
        setSync(navigator.onLine ? "error" : "offline");
        return;
      }
    }
    setSync("saved");
  }, [store]);

  const commit = useCallback((next: Workspace[], changed: Workspace[]) => {
    setList(next);
    writeCache(cacheKey, next);
    changed.forEach((w) => pending.current.set(w.id, w));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [cacheKey, flush]);

  // Read the database's copy on start; unsaved local changes win over it.
  useEffect(() => {
    let live = true;
    store.workspaces().then((remote) => {
      if (!live) return;
      const merged = remote.map((r) => pending.current.get(r.id) ?? r);
      for (const p of pending.current.values()) if (!merged.some((m) => m.id === p.id)) merged.push(p);
      if (!merged.length) {
        const w = newWorkspace(firstSymbol(), "1d", 0);
        commit([w], [w]);
        setActiveId(w.id);
      } else {
        merged.sort((a, b) => a.position - b.position);
        setList(merged);
        writeCache(cacheKey, merged);
      }
      setLoaded(true);
    }).catch(() => {
      setSync("offline");
      setLoaded(true);
    });
    const online = () => flush();
    window.addEventListener("online", online);
    return () => { live = false; window.removeEventListener("online", online); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, userId]);

  useEffect(() => {
    if (activeId) localStorage.setItem(activeKey, activeId);
  }, [activeId, activeKey]);

  const active = list.find((w) => w.id === activeId) ?? list[0] ?? null;

  const update = useCallback((w: Workspace) => {
    commit(listRef.current.map((x) => (x.id === w.id ? w : x)), [w]);
  }, [commit]);

  const add = useCallback((symbol: string, tf: Timeframe) => {
    const w = newWorkspace(symbol, tf, listRef.current.length);
    commit([...listRef.current, w], [w]);
    setActiveId(w.id);
    return w;
  }, [commit]);

  const duplicate = useCallback((w: Workspace) => {
    const idx = listRef.current.findIndex((x) => x.id === w.id);
    const copy = duplicateWorkspace(w, idx + 1);
    const next = [...listRef.current];
    next.splice(idx + 1, 0, copy);
    const renumbered = next.map((x, i) => ({ ...x, position: i }));
    commit(renumbered, renumbered.filter((x, i) => x.position !== next[i].position || x.id === copy.id));
    setActiveId(copy.id);
    return copy;
  }, [commit]);

  const remove = useCallback(async (w: Workspace) => {
    pending.current.delete(w.id);
    const next = listRef.current.filter((x) => x.id !== w.id);
    setList(next);
    writeCache(cacheKey, next);
    if (activeId === w.id) setActiveId(next[0]?.id ?? null);
    try {
      await store.deleteWorkspace(w.id);
    } catch {
      setSync("error");
    }
  }, [store, cacheKey, activeId]);

  return { list, active, setActiveId, update, add, duplicate, remove, sync, loaded };
}
