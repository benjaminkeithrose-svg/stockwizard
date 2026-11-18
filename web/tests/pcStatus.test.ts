import { describe, expect, it } from "vitest";
import { describePc, PcStatus } from "../src/data/pcStatus";

const NOW = new Date("2026-11-18T15:00:00Z");
const beat = (p: Partial<PcStatus> = {}, secondsAgo = 20): PcStatus => ({
  updated_at: new Date(NOW.getTime() - secondsAgo * 1000).toISOString(), host: "BEN-PC", bot_state: "connected",
  bot_detail: "Connected, paper account DU…930", data_state: "streaming", data_detail: null, tws_open: true, version: "0.4.0", ...p,
});

describe("the PC status line", () => {
  it("says all's well in green with the bot connected", () => {
    const d = describePc(beat(), NOW);
    expect(d.kind).toBe("ok");
    expect(d.text).toBe("PC (BEN-PC): bot connected, paper account DU…930 · data streaming · 20 seconds ago");
  });

  it("warns while the bot waits for TWS", () => {
    const d = describePc(beat({ bot_state: "waiting", bot_detail: "TWS isn't taking connections: is it running and logged in to Paper Trading?" }), NOW);
    expect(d.kind).toBe("warn");
    expect(d.text).toContain("bot waiting: TWS isn't taking connections");
  });

  it("goes red when the bot has stopped, with why", () => {
    const d = describePc(beat({ bot_state: "stopped", bot_detail: "The bot key was refused" }), NOW);
    expect(d).toEqual({ kind: "err", text: expect.stringContaining("bot stopped: The bot key was refused") });
  });

  it("goes red when the PC hasn't been heard from for over 2 minutes", () => {
    const d = describePc(beat({}, 12 * 60), NOW);
    expect(d.kind).toBe("err");
    expect(d.text).toBe("PC (BEN-PC): last heard 12 minutes ago. Is the PC on, with Stock Wizard running?");
  });

  it("says how to start when no PC has reported yet", () => {
    expect(describePc(null, NOW).text).toContain("Install the Stock Wizard bot");
  });

  it("leaves the data program out for people who don't run it", () => {
    expect(describePc(beat({ data_state: "off" }), NOW).text).not.toContain("data");
  });
});
