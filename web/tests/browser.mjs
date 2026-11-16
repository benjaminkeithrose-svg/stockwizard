// Drives the built app in Chromium with made-up data (?demo): no network, no
// Supabase. Run: npm run build && node tests/browser.mjs
// A headless browser test, not a phone test.
// Uses the Playwright installed on the machine (NODE_PATH=$(npm root -g)).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const port = 4179;
const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
const base = `http://localhost:${port}/?demo`;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

try {
  await wait(2500);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(base);
  await page.waitForSelector("[data-testid=chart] canvas");
  check(true, "chart draws");
  check(await page.getByText("Made-up candles").isVisible(), "made-up candles are badged");
  check(await page.getByRole("tab", { name: "DEMO 1d" }).isVisible(), "first tab created for the first symbol");
  check((await page.locator("[data-testid=chart] table tr").count()) >= 2, "squeeze pane added below the price");

  // Timeframe
  await page.getByRole("button", { name: "5m", exact: true }).click();
  await wait(300);
  check(await page.getByRole("button", { name: "5m", exact: true }).getAttribute("aria-pressed") === "true", "timeframe switches to 5m");

  // Indicators: add RSI and VWAP
  await page.getByRole("button", { name: "Indicators" }).click();
  await page.getByRole("button", { name: "RSI", exact: true }).click();
  await page.getByRole("button", { name: "VWAP", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await wait(300);
  check(await page.getByText(/RSI 14/).isVisible(), "RSI added");
  check(await page.getByText(/VWAP/).first().isVisible(), "VWAP added");
  const panes = await page.locator("[data-testid=chart] table tr").count();
  check(panes >= 3, `RSI gets its own pane (${panes} rows)`);

  // Draw a level: tool, then tap the chart
  await page.getByRole("button", { name: "Draw" }).click();
  await page.getByRole("button", { name: "Horizontal level" }).click();
  check(await page.getByText("Tap the chart where the level goes").isVisible(), "tap prompt shows");
  const box = await page.locator("[data-testid=chart]").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25);
  await wait(300);
  await page.getByRole("button", { name: "Draw" }).click();
  check(await page.getByText(/Level at/).isVisible(), "level saved on the tab");
  await page.getByRole("button", { name: "Close" }).click();

  // Trendline: two taps
  await page.getByRole("button", { name: "Draw" }).click();
  await page.getByRole("button", { name: "Trendline" }).click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.2);
  await wait(300);
  await page.getByRole("button", { name: "Draw" }).click();
  check(await page.locator(".sheet .card .t", { hasText: "Trendline" }).count() === 1, "trendline saved from two quick taps");
  await page.getByRole("button", { name: "Close" }).click();

  // Save and reopen: everything comes back
  await wait(900);
  await page.reload();
  await page.waitForSelector("[data-testid=chart] canvas");
  await wait(500);
  check(await page.getByRole("button", { name: "5m", exact: true }).getAttribute("aria-pressed") === "true", "timeframe kept after reload");
  check(await page.getByText(/RSI 14/).isVisible(), "indicators kept after reload");
  await page.getByRole("button", { name: "Draw" }).click();
  const kept = await page.locator(".sheet .card .t").allTextContents();
  check(kept.length === 2 && kept.some((t) => t.startsWith("Level")) && kept.some((t) => t.startsWith("Trendline")),
    `both drawings kept after reload (${kept.join("; ")})`);
  await page.getByRole("button", { name: "Close" }).click();

  // Tabs: new, duplicate (opens rename), delete with confirmation
  await page.getByRole("button", { name: "New tab" }).click();
  check((await page.getByRole("tab").count()) === 2, "new tab added");
  await page.getByRole("button", { name: /More for DEMO 5m/ }).first().click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  check(await page.getByRole("dialog", { name: "Rename tab" }).isVisible(), "duplicate opens the copy for renaming");
  await page.getByRole("textbox", { name: "Name" }).fill("My copy");
  await page.getByRole("button", { name: "Done" }).click();
  check(await page.getByRole("tab", { name: "My copy" }).isVisible(), "copy renamed");
  await page.getByRole("button", { name: "More for My copy" }).click();
  await page.getByRole("menuitem", { name: "Delete tab" }).click();
  const detail = await page.locator(".sheet .hint").textContent();
  check(/^Its 4 indicators and 2 drawings\./.test(detail), `delete names what will be lost (${detail})`);
  check(await page.evaluate(() => document.activeElement?.textContent) === "Cancel", "Cancel is the default");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  check(!(await page.getByRole("tab", { name: "My copy" }).count()), "tab deleted");

  // Watchlists: back goes up a level, picking a symbol opens it in the tab
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Watchlists" }).click();
  await page.getByRole("button", { name: /^Made-up list/ }).click();
  check(await page.getByRole("heading", { name: "Made-up list" }).isVisible(), "watchlist opens");
  await page.getByRole("button", { name: "Back" }).click();
  check(await page.getByRole("heading", { name: "Watchlists" }).isVisible(), "back goes up to Watchlists");
  await page.getByRole("button", { name: /^Made-up list/ }).click();
  await page.getByRole("button", { name: /^TEST/ }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("button", { name: /Symbol TEST/ }).isVisible(), "picking a symbol opens it on the chart");

  await page.screenshot({ path: "/tmp/sw-desktop.png" });

  // Phone width
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base);
  await phone.waitForSelector("[data-testid=chart] canvas");
  await wait(500);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, "no sideways scroll at phone width");
  await phone.screenshot({ path: "/tmp/sw-phone.png" });

  check(!errors.length, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
} finally {
  server.kill();
}
console.log(failed ? `${failed} check(s) failed` : "all browser checks passed");
process.exit(failed ? 1 : 0);
