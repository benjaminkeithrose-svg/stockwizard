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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
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

  // Scanner: tabs, nothing-matched shown plainly, a result opens its chart
  await page.getByRole("button", { name: "Scanner" }).click();
  check(await page.getByRole("heading", { name: "Scanner" }).isVisible(), "scanner opens from the header");
  check(await page.getByText("On for 6 candles · momentum +0.42").isVisible(), "squeeze result described in one line");
  await page.getByRole("button", { name: "1h", exact: true }).click();
  check(await page.getByText("Nothing matched.").isVisible(), "no matches said plainly");
  await page.getByRole("button", { name: "SPY", exact: true }).click();
  check(await page.getByText(/-5.4% from the 60-day high · first day · VIX 19.2/).isVisible(), "SPY drawdown shows the VIX");
  await page.getByRole("button", { name: "Fired", exact: true }).click();
  await page.getByRole("button", { name: /^TEST/ }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("button", { name: /Symbol TEST/ }).isVisible(), "tapping a result opens it on the chart");
  check(await page.getByRole("button", { name: "1d", exact: true }).getAttribute("aria-pressed") === "true", "at the scan's timeframe");

  // Chart pages: new page, add cards, drag to swap, reload keeps it, tap opens full screen
  await page.getByRole("button", { name: "Chart pages" }).click();
  check(await page.getByRole("heading", { name: "Chart pages" }).isVisible(), "chart pages open from the header");
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Morning scan");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Add chart" }).click();
  await page.locator(".sheet .chip").first().click();
  await page.getByRole("button", { name: "Add chart" }).click();
  await page.getByRole("button", { name: "New chart tab" }).click();
  await page.waitForTimeout(600);
  const cardsOnPage = page.getByTestId("page-card");
  check(await cardsOnPage.count() === 2, "two charts on the page");
  check(await page.locator(".gbody canvas").count() > 0, "cards draw their charts");
  const ids = await cardsOnPage.evaluateAll((els) => els.map((el) => el.dataset.card));
  const [b1, b2] = [await cardsOnPage.nth(0).boundingBox(), await cardsOnPage.nth(1).boundingBox()];
  check(Math.abs(b1.y - b2.y) < 2 && b2.x > b1.x, "the two cards sit side by side");
  const cardBox = (id) => page.locator(`[data-card="${id}"]`).boundingBox();
  // Drag the second card's title bar onto the first card's spot.
  const bb = await page.locator(`[data-card="${ids[1]}"] .gbar`).boundingBox();
  await page.mouse.move(bb.x + 40, bb.y + 15);
  await page.mouse.down();
  await page.mouse.move(bb.x + 40 - (b2.x - b1.x) / 2, bb.y + 15, { steps: 5 });
  await page.mouse.move(bb.x + 40 - (b2.x - b1.x), bb.y + 15, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dragged = await cardBox(ids[1]), other = await cardBox(ids[0]);
  check(Math.abs(dragged.x - b1.x) < 5 && Math.abs(dragged.y - b1.y) < 5, "dragging snaps the card into the first spot");
  check(other.y > dragged.y + 50, "the card it landed on moved down out of the way");

  // Drop a card lower down: it stays there (no sliding up) until Tidy
  const low = await page.locator(`[data-card="${ids[0]}"] .gbar`).boundingBox();
  await page.mouse.move(low.x + 40, low.y + 15);
  await page.mouse.down();
  await page.mouse.move(low.x + 40, low.y + 15 + 56 * 3, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const lowered = await cardBox(ids[0]);
  check(lowered.y > other.y + 100, "a card dropped lower stays where it was put");
  await page.getByRole("button", { name: "Tidy" }).click();
  await page.waitForTimeout(400);
  check((await cardBox(ids[0])).y < lowered.y - 100, "Tidy slides it back up into the gap");

  // Resize from the corner: the card gets wider
  const cb = await page.locator(`[data-card="${ids[1]}"] .gsize`).boundingBox();
  await page.mouse.move(cb.x + 10, cb.y + 10);
  await page.mouse.down();
  await page.mouse.move(cb.x + 200, cb.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check((await cardBox(ids[1])).width > dragged.width + 100, "resizing from the corner widens the card");

  await page.waitForTimeout(900);
  await page.reload();
  await page.getByRole("button", { name: "Chart pages" }).click();
  await page.waitForTimeout(500);
  const keptCards = await page.getByTestId("page-card").evaluateAll((els) => els
    .map((el) => ({ id: el.dataset.card, y: el.getBoundingClientRect().y, w: el.getBoundingClientRect().width }))
    .sort((a, b) => a.y - b.y));
  check(keptCards.length === 2 && keptCards[0].id === ids[1] && keptCards[0].w > dragged.width + 100,
    "the page layout and sizes are kept after reload");
  const names = [null, await page.locator(`[data-card="${ids[1]}"] .gname`).textContent()];

  // Tap a chart: full screen, no tab strip, Back returns to the page
  await page.locator(`[data-card="${ids[1]}"] .gbody`).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("heading", { name: names[1] }).isVisible(), "tapping a card opens it full screen");
  check(!(await page.getByRole("tablist", { name: "Workspace tabs" }).count()), "full screen shows just that chart");
  check(await page.getByRole("button", { name: "Indicators" }).isVisible(), "with its tools");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(await page.getByRole("heading", { name: "Chart pages" }).isVisible(), "Back returns to the page");

  // Get latest version sits in the ⋯ menu
  await page.getByRole("button", { name: "More", exact: true }).click();
  check(await page.getByRole("menuitem", { name: "Get latest version" }).isVisible(), "Get latest version is in the menu");
  await page.getByRole("menuitem", { name: "Get latest version" }).click();
  await page.waitForURL(/fresh=/, { timeout: 2000 }).catch(() => {});
  await page.waitForSelector("header");
  await page.waitForTimeout(600);
  check(!page.url().includes("fresh="), "the address is tidied after updating");
  check(await page.getByText(/Up to date: build/).isVisible(), "it says it is up to date");
  await page.getByRole("button", { name: "Home" }).click().catch(() => {});

  // Backtests: list shows build and held back side by side; detail has the table, windows and trades
  await page.getByRole("button", { name: "Backtests" }).click();
  check(await page.getByRole("heading", { name: "Backtests" }).isVisible(), "backtests open from the header");
  check(await page.getByText("Build 2006–2021").first().isVisible() && await page.getByText("Held back 2021–now").first().isVisible(),
    "build and held-back periods side by side");
  await page.getByRole("button", { name: /Made-up signal → \+40%/ }).click();
  check(await page.getByRole("heading", { name: "Made-up signal → +40%" }).isVisible(), "a strategy opens its own page");
  check(await page.getByRole("cell", { name: /Reached target/ }).isVisible(), "results table shows the target rate");
  check(await page.getByRole("row", { name: /Likely range.*7–22/ }).isVisible(), "with the likely range for the next 100 trades");
  check(await page.getByText(/A signal study/).isVisible(), "the study note says the VIX index can't be traded");
  check(await page.getByText(/reached target · 10 days/).isVisible(), "trades are listed");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(await page.getByRole("heading", { name: "Backtests" }).isVisible(), "Back returns to the list");
  await page.getByRole("button", { name: "Pattern lab" }).click();
  check(await page.getByText("patterns tried").isVisible(), "the pattern lab shows how many patterns were tried");
  check(await page.getByText(/Sealed years \(blind backtest\)/).isVisible(), "survivors show their sealed-years result");
  check(await page.getByText(/Discovery \(saw the future\)/).first().isVisible(), "discovery numbers are labelled as having seen the future");
  check(await page.getByText(/needs 0.05 or less/).isVisible(), "near-misses say why they failed");
  await page.getByRole("button", { name: "Strategies" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Watchlists: back goes up a level, picking a symbol opens it in the tab
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Watchlists" }).click();
  await page.getByRole("button", { name: /^Made-up list/ }).click();
  check(await page.getByRole("heading", { name: "Made-up list" }).isVisible(), "watchlist opens");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(await page.getByRole("heading", { name: "Watchlists" }).isVisible(), "back goes up to Watchlists");
  await page.getByRole("button", { name: /^Made-up list/ }).click();
  await page.getByRole("button", { name: /^TEST/ }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("button", { name: /Symbol TEST/ }).isVisible(), "picking a symbol opens it on the chart");

  await page.screenshot({ path: "/tmp/sw-desktop.png" });
  await page.getByRole("button", { name: "Chart pages" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/sw-pages.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Phone width
  // Same browser profile as above, so the page made there is here too.
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base);
  await phone.waitForSelector("[data-testid=chart] canvas");
  await wait(500);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, "no sideways scroll at phone width");
  await phone.getByRole("button", { name: "Chart pages" }).click();
  await phone.waitForTimeout(800);
  const phoneCards = await phone.evaluate(() => [...document.querySelectorAll("[data-testid=page-card]")].map((el) => {
    const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y) };
  }));
  check(phoneCards.length === 2 && phoneCards[0].x === phoneCards[1].x && phoneCards[1].y > phoneCards[0].y && phoneCards[0].w > 330,
    `phone shows one card per row (${JSON.stringify(phoneCards)})`);
  check(!(await phone.locator(".gsize").count()), "no resize corners on the phone");
  await phone.screenshot({ path: "/tmp/sw-pages-phone.png" });
  await phone.getByRole("button", { name: "Back", exact: true }).click();
  await phone.screenshot({ path: "/tmp/sw-phone.png" });

  check(!errors.length, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
} finally {
  server.kill();
}
console.log(failed ? `${failed} check(s) failed` : "all browser checks passed");
process.exit(failed ? 1 : 0);
