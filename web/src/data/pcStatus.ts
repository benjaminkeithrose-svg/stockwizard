// The PC status line (Ben, 18 Nov 2026: one installed program, stage 1). The supervisor on
// each person's PC writes a heartbeat to Supabase every 30 seconds (`pc_status`): their bot,
// on Ben's PC the data program, and whether TWS is taking connections. The app turns it into
// one plain line on any device, so a PC that's off or a TWS logged out shows from the phone.

export interface PcStatus {
  updated_at: string;
  host: string | null;
  bot_state: "off" | "starting" | "connected" | "waiting" | "stopped";
  bot_detail: string | null;
  data_state: "off" | "starting" | "catching up" | "idle" | "streaming" | "stopped" | null;
  data_detail: string | null;
  tws_open: boolean;
  version: string | null;
}

/** A heartbeat older than this means the PC, or Stock Wizard on it, isn't running. */
export const STALE_MS = 2 * 60_000;

const ago = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
};

/** The line to show, and how it should look: ok (green), warn (amber) or err (red). */
export function describePc(s: PcStatus | null, now: Date): { kind: "ok" | "warn" | "err"; text: string } {
  if (!s) return { kind: "warn", text: "PC: no word yet. Install Stock Wizard on your PC (Menu, Access key, setup guide) and open it." };
  const age = now.getTime() - Date.parse(s.updated_at);
  const where = s.host ? ` (${s.host})` : "";
  if (age > STALE_MS) return { kind: "err", text: `PC${where}: last heard ${ago(age)}. Is the PC on, with Stock Wizard running?` };
  const bot = s.bot_state === "connected" ? (s.bot_detail ?? "trading connected").replace(/^Connected( to Interactive Brokers)?/, "trading connected")
    : s.bot_state === "waiting" ? `trading waiting: ${s.bot_detail ?? "TWS isn't taking connections"}`
    : s.bot_state === "starting" ? "trading starting"
    : `trading stopped${s.bot_detail ? `: ${s.bot_detail}` : ""}`;
  const data = s.data_state && s.data_state !== "off" ? ` · market data ${s.data_state}` : "";
  const kind = s.bot_state === "connected" && s.data_state !== "stopped" ? "ok" : s.bot_state === "stopped" ? "err" : "warn";
  return { kind, text: `PC${where}: ${bot}${data} · ${ago(age)}` };
}
