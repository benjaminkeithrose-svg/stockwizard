// Changes made on this device but not yet saved to the database. Saving waits
// a moment after each change (so a drag isn't hundreds of writes); keeping the
// waiting changes on the device too means closing the app in that moment
// loses nothing: they are sent on the next start.

export function readUnsaved<T extends { id: string }>(key: string): Map<string, T> {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
    return new Map(list.map((x) => [x.id, x]));
  } catch {
    return new Map();
  }
}

export function keepUnsaved<T>(key: string, pending: Map<string, T>) {
  try {
    if (pending.size) localStorage.setItem(key, JSON.stringify([...pending.values()]));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: the change still saves while the app stays open */
  }
}
