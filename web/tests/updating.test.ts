import { describe, expect, it } from "vitest";
import { behind, buildFromServiceWorker, plan } from "../src/data/updating";

const pc = (available: string | null, can_apply = true) => ({ current: "0.2.29", available, can_apply, label: "", error: null });

describe("one Update button", () => {
  it("reads the newest build from the published service worker", () => {
    expect(buildFromServiceWorker('// ...\nconst CACHE = "stockwizard-sw-v47";')).toBe("sw-v47");
    expect(buildFromServiceWorker("nothing here")).toBeNull();
    expect(behind("sw-v46", "sw-v47")).toBe(true);
    expect(behind("sw-v47", "sw-v47")).toBe(false);
    expect(behind("sw-v47", null)).toBe(false);
  });
  it("updates whatever is behind, the PC program first, and waits for the US close", () => {
    expect(plan({ appLatest: "sw-v47", appBehind: false, pc: null })).toMatchObject({ label: "Up to date", can: false });
    expect(plan({ appLatest: "sw-v48", appBehind: true, pc: null })).toMatchObject({ label: "Update the app", can: true });
    expect(plan({ appLatest: "sw-v48", appBehind: true, pc: pc("0.2.30") }).label).toBe("Update (Stock Wizard 0.2.30 and the app)");
    const waits = plan({ appLatest: "sw-v48", appBehind: true, pc: pc("0.2.30", false) });
    expect(waits).toMatchObject({ label: "Update the app", can: true });
    expect(waits.note).toMatch(/waits until the US market closes/);
    expect(plan({ appLatest: "sw-v47", appBehind: false, pc: pc("0.2.30", false) })).toMatchObject({ can: false });
  });
});
