// One Update for everything (Ben, 19 Nov 2026: "why are there 2 update pathways?"). Stock Wizard
// is two pieces: the app (these screens, loaded from the web, updated by reloading) and, on a PC,
// the installed program (trading, market data, backtests, updated by its installer). This works
// out which is behind and updates both with one press: the app's own cache is cleared first, so
// when the PC program reopens after its installer it loads the new app too.

import { APP_BUILD } from "../config";
import { clearAppCaches, getLatestVersion } from "../update";
import { pcBridge, PcUpdates } from "./pc";

export interface UpdateState {
  /** The newest app build published, or null when it couldn't be checked (offline). */
  appLatest: string | null;
  appBehind: boolean;
  /** The PC program's state, inside the installed program only. */
  pc: PcUpdates | null;
}

/** The published service worker names the newest build ("stockwizard-sw-v46"); compare it with this one. */
export function buildFromServiceWorker(text: string): string | null {
  const m = text.match(/stockwizard-(sw-v\d+)/);
  return m ? m[1] : null;
}

export function behind(current: string, latest: string | null): boolean {
  const n = (b: string | null) => Number((b ?? "").replace(/\D/g, "")) || 0;
  return !!latest && n(latest) > n(current);
}

export async function checkUpdates(): Promise<UpdateState> {
  let appLatest: string | null = null;
  try {
    const r = await fetch(`./sw.js?check=${Date.now()}`, { cache: "no-store" });
    if (r.ok) appLatest = buildFromServiceWorker(await r.text());
  } catch { /* offline: can't tell */ }
  const bridge = await pcBridge(800);
  const pc = bridge ? await bridge.check_updates().catch(() => null) : null;
  return { appLatest, appBehind: behind(APP_BUILD, appLatest), pc };
}

/** What the one Update button says and does, from the state. */
export function plan(s: UpdateState): { label: string; can: boolean; note: string } {
  const pcReady = !!s.pc?.available && s.pc.can_apply;
  const pcWaits = !!s.pc?.available && !s.pc.can_apply;
  if (pcReady) return { label: `Update (Stock Wizard ${s.pc!.available}${s.appBehind ? " and the app" : ""})`, can: true,
    note: "Stock Wizard closes, installs the update and opens again by itself in a minute or so." };
  if (s.appBehind) return { label: "Update the app", can: true,
    note: pcWaits ? `The app updates now; Stock Wizard ${s.pc!.available} on this PC waits until the US market closes, so trading isn't cut off.` : "Reloads with the newest build in a few seconds." };
  if (pcWaits) return { label: `Update after the US close`, can: false,
    note: `Stock Wizard ${s.pc!.available} is ready; it installs after the US market closes, so trading isn't cut off.` };
  return { label: "Up to date", can: false, note: "" };
}

/** Do whatever the plan says: the PC program's installer (with the app's cache cleared first), or the app reload. */
export async function updateEverything(s: UpdateState): Promise<string | null> {
  if (s.pc?.available && s.pc.can_apply) {
    await clearAppCaches();
    const bridge = await pcBridge(800);
    const r = bridge ? await bridge.install_update() : { error: "Stock Wizard on this PC didn't answer" };
    return r.error ?? null;
  }
  if (s.appBehind) await getLatestVersion();
  return null;
}
