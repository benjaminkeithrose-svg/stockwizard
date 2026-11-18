// Light, dark, or match the computer (Ben, 18 Nov 2026: cues from Financial Vault). Chosen per
// device and kept in this browser (the name starts "stockwizard": the address is shared with
// Ben's other apps). Applied to <html data-mode="light|dark">, which the stylesheet and the
// chart read; "match computer" follows the device's own setting as it changes.

export type Mode = "light" | "dark" | "system";
export const MODES: { id: Mode; name: string }[] = [
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "system", name: "Match device" },
];

const KEY = "stockwizard.theme";
export const THEME_EVENT = "stockwizard-theme";

const darkQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function readMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

/** Light or dark, after "match device" is worked out. */
export function resolved(mode: Mode = readMode(), deviceDark = !!darkQuery?.matches): "light" | "dark" {
  return mode === "system" ? (deviceDark ? "dark" : "light") : mode;
}

export function applyMode(mode: Mode = readMode()): void {
  const r = resolved(mode);
  const root = document.documentElement;
  root.dataset.mode = r;
  root.style.colorScheme = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", r === "dark" ? "#0F151A" : "#FFFFFF");
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* still applies for this visit */
  }
  applyMode(mode);
}

darkQuery?.addEventListener?.("change", () => {
  if (readMode() === "system") applyMode();
});

/** A colour variable's current value, for the chart (which draws on a canvas, not with the stylesheet). */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
