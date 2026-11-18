// Talking to Stock Wizard on the PC (Ben, 19 Nov 2026: setup inside the app). Inside the
// installed program's window, pywebview puts its bridge at window.pywebview.api (the
// `Bridge` in backend/stockwizard/supervisor.py); in a browser or on the phone there's none,
// and Setup shows the PC steps as instructions instead. The bridge never hands keys back:
// only whether one is set.

export type Job = "main" | "watch" | "trading";
export const JOB_LABELS: Record<Job, string> = { main: "Main chart", watch: "Watch page", trading: "Trading" };

export interface PcSettings {
  bot_key_set: boolean;
  uses_secret_key: boolean;
  connection: "tws" | "gateway";
  delayed: boolean;
  ntfy_topic: string;
  run_data: boolean | null;
  configured: boolean;
  /** Monitor number (as text) to its job. */
  screens: Record<string, Job>;
}

export interface PcState {
  ready: boolean;
  tws_open: boolean;
  bot_state: string;
  bot_detail: string | null;
  data_state: string;
}

/** The PC program's version and any update waiting (stockwizard.updates.Updater.summary). */
export interface PcUpdates { current: string | null; available: string | null; can_apply: boolean; label: string; error: string | null }

export interface Monitor { index: number; width: number; height: number; x: number; y: number }

type Result = { ok?: true; error?: string };

interface Bridge {
  load(): Promise<PcSettings>;
  save(form: Record<string, unknown>): Promise<Result>;
  set_key(key: string): Promise<Result>;
  set_screens(screens: Record<string, Job>): Promise<Result>;
  status(): Promise<PcState>;
  monitors(): Promise<Monitor[]>;
  updates(): Promise<PcUpdates>;
  check_updates(): Promise<PcUpdates>;
  install_update(): Promise<Result>;
}

declare global {
  interface Window { pywebview?: { api?: Bridge } }
}

/** The PC program's bridge, waiting up to `ms` for it to arrive; null in a browser or on the phone. */
export function pcBridge(ms = 1500): Promise<Bridge | null> {
  if (window.pywebview?.api?.load) return Promise.resolve(window.pywebview.api);
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener("pywebviewready", done); clearTimeout(t); resolve(window.pywebview?.api?.load ? window.pywebview.api : null); };
    const t = window.setTimeout(done, ms);
    window.addEventListener("pywebviewready", done);
  });
}

/** Which job this window was opened for (Setup, Screens: `?view=watch` and so on), if any. */
export function viewFromUrl(search = window.location.search): Job | null {
  const v = new URLSearchParams(search).get("view");
  return v === "main" || v === "watch" || v === "trading" ? v : null;
}

/** Each monitor's job, from the person's choices: one main window at most; unchosen monitors off. */
export function setJob(screens: Record<string, Job>, monitor: number, job: Job | null): Record<string, Job> {
  const out: Record<string, Job> = {};
  for (const [k, j] of Object.entries(screens)) if (Number(k) !== monitor && !(job === "main" && j === "main")) out[k] = j;
  if (job) out[String(monitor)] = job;
  return out;
}

export const SETUP_SEEN = "stockwizard.setupSeen";
