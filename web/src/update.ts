// "Get latest version": throw away this app's saved copy and load it fresh.
//
// Only Stock Wizard's own files: GitHub Pages puts Ben's other apps (Field
// CRM, Metal Hunter, Belt Call Log, Expenses) on the same web address, so
// their offline copies and service workers are left alone. Nothing saved in
// the app is touched: tabs, pages and sign-in are in local storage and the
// database, not in these caches.

const BUSTER = "fresh";

export async function getLatestVersion(): Promise<void> {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("stockwizard-")).map((k) => caches.delete(k)));
  } catch { /* no Cache API: the reload still helps */ }
  try {
    const scope = new URL("./", location.href).href;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.filter((r) => r.scope === scope).map((r) => r.unregister()));
  } catch { /* no service workers */ }
  // A unique address makes sure the browser's own cache can't answer either.
  const url = new URL(location.href);
  url.searchParams.set(BUSTER, Date.now().toString(36));
  location.replace(url.toString());
}

/** After the fresh load, tidy the address and say so. True if we just updated. */
export function cameBackFresh(): boolean {
  const url = new URL(location.href);
  if (!url.searchParams.has(BUSTER)) return false;
  url.searchParams.delete(BUSTER);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;
}

/** Ask the browser to look for a new version on every launch, so most updates arrive unasked. */
export async function checkForUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  } catch { /* offline */ }
}
