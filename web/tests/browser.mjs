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
// Every screen is in the full-screen Menu (18 Nov 2026: cues from Financial Vault).
const menuItem = (page, name) => page.getByRole("navigation", { name: "Screens" }).getByRole("button", { name, exact: true });
const menuItemCount = async (page, name) => { await page.getByRole('button', { name: 'Menu', exact: true }).click(); const n = await page.locator('.navmenu button', { hasText: name }).count(); await page.keyboard.press('Escape'); return n; };

const openFromMenu = async (page, name) => { await page.getByRole("button", { name: "Menu", exact: true }).click(); await menuItem(page, name).click(); };

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
  const onChart = () => page.evaluate(() => JSON.parse(localStorage.getItem("stockwizard.demo") ?? "{}").workspaces?.flatMap((w) => w.indicators.map((i) => i.name)) ?? []);
  await wait(900);
  check((await onChart()).includes("rsi"), "RSI added");
  check((await onChart()).includes("vwap"), "VWAP added");
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
  // A change followed at once by closing the app is not lost (saving waits a moment after each change)
  await page.getByRole("button", { name: "1h", exact: true }).click();
  await page.reload();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("button", { name: "1h", exact: true }).getAttribute("aria-pressed") === "true", "a change made just before closing is kept");
  await wait(900);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("stockwizard.demo")).workspaces.some((w) => w.timeframe === "1h")), "and is sent on the next start");
  await page.getByRole("button", { name: "5m", exact: true }).click();
  await wait(900);
  await page.getByRole("button", { name: /^Indicators, \d+ on this chart/ }).click();
  check(await page.locator(".sheet .card .t", { hasText: "RSI 14" }).count() === 1, "indicators kept after reload");
  await page.getByRole("button", { name: "Done" }).click();
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

  // Indicators: one button with the count; the sheet lists them, its favourites add in one tap; the chip row has no indicators
  check(!(await page.locator(".chipbar .xchip:not(.opt)").count()), "no indicator chips crowd the row above the chart");
  const indBtn = page.getByRole("button", { name: /^Indicators, \d+ on this chart/ });
  const nInd = Number((await indBtn.getAttribute("aria-label")).match(/\d+/)[0]);
  check(nInd > 0 && (await indBtn.textContent()).includes(String(nInd)), `the Indicators button shows how many are on (${nInd})`);
  await indBtn.click();
  await page.getByRole("button", { name: "Remove RSI 14", exact: true }).click();
  check(await page.getByRole("button", { name: "Add RSI 14" }).isVisible(), "a favourite taken off shows under Favourites");
  await page.getByRole("button", { name: "Add RSI 14" }).click();
  check(await page.locator(".sheet .card .t", { hasText: "RSI 14" }).count() === 1, "a favourite adds in one tap");
  check(await page.getByRole("button", { name: "Remove RSI 14 from favourites" }).getAttribute("aria-pressed") === "true", "favourites are starred");
  await page.getByRole("button", { name: "Add VWAP to favourites" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await page.waitForSelector("[data-testid=chart] canvas");
  await wait(300);
  await page.getByRole("button", { name: /^Indicators, \d+ on this chart/ }).click();
  await page.getByRole("button", { name: "Remove VWAP", exact: true }).click();
  check(await page.getByRole("button", { name: "Add VWAP" }).isVisible(), "a starred indicator stays in Favourites after a reload");
  await page.getByRole("button", { name: "Done" }).click();
  // Structure favourites: the star for every chart, the symbol button for this symbol only
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: "Add Bull put (credit) to DEMO's favourites" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  check(await page.locator(".chipbar").getByRole("button", { name: "Add Bull put (credit)" }).isVisible(), "a symbol's own favourite shows on its chart");
  await page.getByRole("tab", { name: /^DEMO.*change the symbol/ }).click();   // the open tab is the symbol control
  await page.getByRole("textbox").first().fill("TEST");
  await page.getByRole("button", { name: /^TEST/ }).first().click();
  await wait(400);
  check(!(await page.locator(".chipbar").getByRole("button", { name: "Add Bull put (credit)" }).count()), "and not on another symbol's");
  await page.getByRole("tab", { name: /^TEST.*change the symbol/ }).click();
  await page.getByRole("textbox").first().fill("DEMO");
  await page.getByRole("button", { name: /^DEMO/ }).first().click();
  await wait(400);

  // Calls and puts: place an iron condor, drag it, mark it bought, delete it
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: /^Iron condor Sell a put/ }).click();
  check(await page.getByText("Drag a line to move").isVisible(), "placing a structure starts adjusting it");
  const ic = page.locator(".xchip.opt");
  check(await ic.count() === 1 && (await ic.getAttribute("class")).includes("planned"), "it shows as a purple chip");
  const legsAt = async () => JSON.parse(await page.locator("[data-testid=chart]").getAttribute("data-legs") || "[]");
  await wait(300);
  const ys = await legsAt();
  check(ys.length === 4 && ys.every((y) => y !== null) && ys[0] > ys[1] && ys[1] > ys[2] && ys[2] > ys[3], `four legs drawn, wings outside (${ys.map(Math.round)})`);
  const chartBox = await page.locator("[data-testid=chart]").boundingBox();
  // The lines carry only ▲ or ▼; hovering on one shows what it is
  await page.mouse.move(chartBox.x + chartBox.width / 3, chartBox.y + ys[1]);
  const tip = page.getByRole("tooltip");
  check(await tip.isVisible() && /▼ Short put \d/.test(await tip.textContent()) && /expires/.test(await tip.textContent()) && /Planned/.test(await tip.textContent()),
    `hovering on a leg names it, with its expiry (${await tip.textContent().catch(() => "no box")})`);
  await page.screenshot({ path: "/tmp/sw-legtip.png" });
  await page.mouse.move(chartBox.x + chartBox.width / 3, chartBox.y + (ys[1] + ys[2]) / 2);
  check(!(await tip.count()), "and the box goes when the pointer moves off");
  const strikes = async () => (await page.locator("[data-testid=chart]").evaluate(() => JSON.parse(localStorage.getItem("stockwizard.demo")).positions[0].legs.map((l) => l.strike)));
  await wait(800);
  const before = await strikes();
  const dragY = async (from, by) => {
    await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + from);
    await page.mouse.down();
    for (let k = 1; k <= 5; k++) await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + from + (by * k) / 5);
    await page.mouse.up();
    await wait(900);
  };
  await dragY(ys[1], -40);
  const whole = await strikes();
  const d = whole[1] - before[1];
  check(d > 0 && whole.every((s, i) => s - before[i] === d), `dragging with All moves every leg together (${before} → ${whole})`);
  await page.getByRole("button", { name: "Leg", exact: true }).click();
  await wait(300);
  const ys2 = await legsAt();
  await dragY(ys2[3], -30);
  const leg = await strikes();
  check(leg[3] > whole[3] && leg.slice(0, 3).join() === whole.slice(0, 3).join(), `dragging with Leg moves just that wing (${whole} → ${leg})`);
  // Analysis: the chip opens it; theoretical prices, sliders, graphs, comparison; Adjust goes back to dragging
  await page.getByRole("button", { name: /^Iron condor .*, analyse$/ }).click();
  await page.waitForSelector(".analysis .graph svg");
  check(await page.getByText("Theoretical", { exact: true }).isVisible(), "the analysis says its prices are theoretical");
  check(await page.getByRole("img", { name: "Profit or loss across prices" }).isVisible(), "the profit and loss graph draws");
  check(await page.getByRole("img", { name: /from today to expiry/ }).isVisible(), "the time-decay graph draws");
  const pop1 = await page.locator(".kv > div", { hasText: "Chance of profit" }).locator("b").textContent();
  await page.locator("#ana-vol").fill("60");
  const pop2 = await page.locator(".kv > div", { hasText: "Chance of profit" }).locator("b").textContent();
  check(pop1 !== pop2, `the volatility slider changes the numbers (${pop1} → ${pop2})`);
  check(await page.getByRole("button", { name: /^back to/ }).isVisible(), "and offers the way back to the estimate");
  await page.getByRole("button", { name: "+ Compare" }).click();
  await page.locator(".sheet .chips .chip").nth(6).click();
  await page.getByRole("button", { name: /^Compare with/ }).click();
  check(await page.getByRole("table", { name: "Comparison" }).isVisible(), "comparing adds a side-by-side table");
  check((await page.getByRole("columnheader").count()) === 3, "with a column for each structure");
  await page.locator("#ana-date").fill("2");
  check(await page.getByText(/^Date: (?!today)/).isVisible(), "the date slider moves the date on");
  await page.getByRole("button", { name: "Order (paper)" }).click();
  check(await page.getByRole("dialog", { name: "Order (paper)" }).isVisible(), "Order (paper) opens with the estimate");
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "Send as a paper order" }).click();
  check(await page.getByText(/Sent to Stock Wizard on your PC/).isVisible(), "the order request goes to the bot");
  await page.getByRole("dialog", { name: "Order (paper)" }).getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Adjust on the chart" }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByText("Drag a line to move").isVisible(), "Adjust on the chart goes back to dragging it");
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Bought", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  check((await ic.getAttribute("class")).includes("bought"), "marking it bought turns it green");
  await page.reload();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.locator(".xchip.opt.bought").count() === 1, "it is still there after a reload");
  await page.getByRole("button", { name: /^Delete Iron condor/ }).click();
  const posDetail = await page.locator(".sheet .hint").textContent();
  check(/4 legs/.test(posDetail) && /doesn't close anything at a broker/.test(posDetail), `deleting names the legs and says nothing is closed at a broker (${posDetail})`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  check(!(await page.locator(".xchip.opt").count()), "structure deleted");

  // Scanner: tabs, nothing-matched shown plainly, a result opens its chart
  await openFromMenu(page, "Scanner");
  check(await page.getByRole("heading", { name: "Scanner" }).isVisible(), "scanner opens from the menu");
  check(await page.getByText("On for 6 candles · momentum +0.42").isVisible(), "squeeze result described in one line");
  await page.getByRole("button", { name: "1h", exact: true }).click();
  check(await page.getByText("Nothing matched.").isVisible(), "no matches said plainly");
  await page.getByRole("button", { name: "SPY", exact: true }).click();
  check(await page.getByText(/-5.4% from the 60-day high · first day · VIX 19.2/).isVisible(), "SPY drawdown shows the VIX");
  await page.getByRole("button", { name: "Fired", exact: true }).click();
  await page.getByRole("button", { name: /^TEST/ }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("tab", { name: /^TEST.*change the symbol/ }).isVisible(), "tapping a result opens it on the chart");
  check(await page.getByRole("button", { name: "1d", exact: true }).getAttribute("aria-pressed") === "true", "at the scan's timeframe");

  // Chart pages: new page, add cards, drag to swap, reload keeps it, tap opens full screen
  await openFromMenu(page, "Chart pages");
  check(await page.getByRole("heading", { name: "Chart pages" }).isVisible(), "chart pages open from the menu");
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
  await openFromMenu(page, "Chart pages");
  await page.waitForTimeout(500);
  const keptCards = await page.getByTestId("page-card").evaluateAll((els) => els
    .map((el) => ({ id: el.dataset.card, y: el.getBoundingClientRect().y, w: el.getBoundingClientRect().width }))
    .sort((a, b) => a.y - b.y));
  check(keptCards.length === 2 && keptCards[0].id === ids[1] && keptCards[0].w > dragged.width + 100,
    "the page layout and sizes are kept after reload");
  const names = [null, await page.locator(`[data-card="${ids[1]}"] .gname`).textContent()];

  // Tap a chart: it's selected and the one toolbar acts on it; its expand button opens it full screen
  await page.locator(`[data-card="${ids[1]}"] .gbody`).click();
  check(await page.locator(`[data-card="${ids[1]}"]`).evaluate((el) => el.classList.contains("sel")), "tapping a card selects it");
  check(await page.getByRole("toolbar", { name: "Chart tools" }).isVisible(), "with one toolbar for the page");
  await page.getByRole("button", { name: `Open ${names[1]} full screen` }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("heading", { name: names[1] }).isVisible(), "its expand button opens it full screen");
  check(!(await page.getByRole("tablist", { name: "Workspace tabs" }).count()), "full screen shows just that chart");
  check(await page.getByRole("button", { name: "Indicators" }).isVisible(), "with its tools");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(await page.getByRole("heading", { name: "Chart pages" }).isVisible(), "Back returns to the page");

  // One place for updates: Updates and what's new, with one Update button (up to date in the test)
  await openFromMenu(page, "Updates and what's new");
  check(await page.getByRole("button", { name: /Up to date/ }).isVisible(), "the one update button says it's up to date");
  check(!(await menuItemCount(page, "Get latest version")), "no separate Get latest version");
  await page.getByRole("button", { name: "Home" }).click().catch(() => {});

  // The Lab: Ideas, Backtested, Paper trading; verdicts from the held-back years; Start paper trading
  await openFromMenu(page, "Lab");
  check(await page.getByRole("heading", { name: "Lab" }).isVisible(), "the Lab opens from the menu");
  await page.getByRole("tab", { name: "Backtested" }).click();
  await page.getByRole("button", { name: "Stock signals" }).click();
  check(await page.getByText("Build 2006–2021").first().isVisible() && await page.getByText("Held back 2021–now").first().isVisible(),
    "build and held-back periods side by side");
  check(await page.locator(".card", { hasText: "Made-up signal → +40%" }).locator(".badge").first().isVisible(), "each backtest has a verdict");
  await page.getByRole("button", { name: /Made-up signal → \+40%/ }).click();
  check(await page.getByRole("heading", { name: "Made-up signal → +40%" }).isVisible(), "a strategy opens its own page");
  check(await page.getByRole("cell", { name: /Reached target/ }).isVisible(), "results table shows the target rate");
  check(await page.getByRole("row", { name: /Likely range.*7–22/ }).isVisible(), "with the likely range for the next 100 trades");
  check(await page.getByText(/A signal study/).isVisible(), "the study note says the VIX index can't be traded");
  check(await page.getByText(/reached target · 10 days/).isVisible(), "trades are listed");
  check(!(await page.getByRole("button", { name: "Start paper trading" }).count()) && await page.getByText(/Can't be automated: These are stock signals/).isVisible(),
    "a stock strategy says why it can't be paper traded");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(await page.getByRole("heading", { name: "Lab" }).isVisible(), "Back returns to the Lab");
  await page.getByRole("tab", { name: "Ideas" }).click();
  await page.getByRole("button", { name: "Pattern lab" }).click();
  check(await page.getByText("patterns tried").isVisible(), "the pattern lab shows how many patterns were tried");
  check(await page.getByText(/Sealed years \(blind backtest\)/).isVisible(), "survivors show their sealed-years result");
  check(await page.getByText(/Discovery \(saw the future\)/).first().isVisible(), "discovery numbers are labelled as having seen the future");
  check(await page.getByText(/needs 0.05 or less/).isVisible(), "near-misses say why they failed");
  await page.getByRole("button", { name: "0DTE research" }).click();
  check(await page.getByText(/Modelled option prices: not evidence/).isVisible(), "the 0DTE research says first that its prices are modelled");
  check(await page.getByRole("img", { name: /Development against validation/ }).isVisible(), "the did-they-hold-up chart draws");
  await page.getByRole("button", { name: /^Made-up condor B/ }).click();
  check(await page.getByText("If you'd started with $5,000 (validation)").isVisible(), "a 0DTE survivor shows the $5,000 kitty");
  check(await page.getByRole("img", { name: /Walk-forward blocks/ }).isVisible() && await page.getByRole("table", { name: "By regime" }).isVisible(),
    "a survivor shows its walk-forward blocks and results by market conditions");
  await page.getByRole("dialog", { name: "Strategy" }).getByRole("button", { name: "Start paper trading" }).click();
  check(await page.getByRole("dialog", { name: "New automated strategy" }).getByText(/^Tested: Made-up/).isVisible(), "a survivor starts marked tested");
  await page.getByRole("dialog", { name: "New automated strategy" }).getByRole("button", { name: "Done" }).click();
  check(await page.getByText(/Saved, switched off/).isVisible(), "it's saved, switched off");
  await page.getByRole("dialog", { name: "Strategy" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("tab", { name: "Backtested" }).click();
  await page.getByRole("button", { name: "Option structures" }).click();
  check(await page.getByText(/Build 64% won, \+\$39 a trade · Held back 51% won, \+\$31 a trade/).isVisible(), "option structures show build and held back side by side");
  check(await page.locator(".card", { hasText: "Made-up 9-day iron condor" }).getByText("Held up").isVisible(), "a held-back profit reads Held up");
  await page.getByRole("button", { name: /^Made-up 9-day iron condor/ }).click();
  check(await page.getByRole("heading", { name: "Made-up 9-day iron condor" }).isVisible(), "an option strategy opens its own page, named");
  const mk = page.getByRole("button", { name: "Start paper trading" });
  const [mkBox, firstRow] = [await mk.boundingBox(), await page.getByRole("table", { name: "Build and held back" }).boundingBox()];
  check(mkBox && firstRow && mkBox.y < firstRow.y, "Start paper trading sits at the top of a backtest page");
  await mk.click();
  check(await page.getByText(/SPY · Iron condor · 10:00 · expires 9 days · shorts 1× daily range · \$5 wide/).first().isVisible(), "an option backtest maps to the strategy's settings");
  await page.getByRole("dialog", { name: "New automated strategy" }).getByRole("button", { name: "Done" }).click();
  check(await page.getByText(/Modelled option prices/).isVisible(), "it says the prices are modelled");
  check(await page.getByRole("row", { name: /Likely wins in the next 100.*56–72.*43–59/ }).isVisible(), "with the likely range for the next 100 trades");
  check(await page.getByRole("img", { name: "Running total, trade by trade" }).isVisible(), "the running profit or loss draws");
  check(await page.getByRole("table", { name: "The $5,000 kitty" }).isVisible(), "the option backtest shows the $5,000 kitty");
  check(await page.getByRole("img", { name: /kitty's balance/ }).isVisible(), "with its balance trade by trade");
  check(await page.locator(".card", { hasText: "settled" }).count() === 30, "the newest 30 trades are listed");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("tab", { name: "Paper trading" }).click();
  check(await page.locator(".card.strat", { hasText: "Made-up 9-day iron condor" }).isVisible(), "the Paper trading tab lists the automated strategies");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Claude: ask at the top, the answer under it, actions as buttons; the conversation survives a reload
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  check(await page.getByRole("complementary", { name: "Claude" }).isVisible(), "the Claude panel opens");
  await page.getByRole("textbox", { name: "Ask Claude" }).fill("Test trend breaks against the VIX");
  await page.getByRole("button", { name: "Ask Claude" }).click();
  await page.getByText(/Made-up reply to/).waitFor();
  check(await page.getByText("Ran a backtest").isVisible(), "Claude's actions are listed in plain words");
  await page.getByRole("button", { name: "Open the backtest" }).click();
  check(await page.getByRole("heading", { name: "Made-up signal → +40%" }).isVisible(), "Open the backtest goes to its page");
  await page.reload();
  await page.waitForSelector("header");
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  check(await page.getByText("Test trend breaks against the VIX", { exact: true }).isVisible(), "the conversation is kept after a reload");
  await page.getByRole("button", { name: "More for Claude" }).click();
  await page.getByRole("menuitem", { name: "New conversation" }).click();
  check(await page.getByText(/Its 1 exchange with Claude/).isVisible(), "clearing names what will be lost");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  check(!(await page.getByText("Test trend breaks against the VIX", { exact: true }).count()), "a new conversation starts empty");
  await page.getByRole("button", { name: "Close Claude" }).click();
  await page.getByRole("button", { name: "Home" }).click().catch(() => {});

  // Safety and limits: the daily limit starts empty, the limits save; the kill switch stops and resumes
  await openFromMenu(page, "Safety and limits");
  check(await page.getByRole("heading", { name: "Safety and limits" }).isVisible(), "Safety and limits opens from the menu");
  check(await page.getByText(/daily loss limit isn't set, so every order is refused/).isVisible(), "an empty daily limit is flagged");
  check(await page.getByText(/Live trading is disabled and can't be turned on/).isVisible(), "says live trading can't be turned on");
  check(!(await page.getByRole("button", { name: /live/i }).count()) && !(await page.getByRole("checkbox", { name: /live/i }).count()), "no live-trading control");
  await page.getByRole("button", { name: "Change limits" }).click();
  await page.getByLabel(/Most a day may lose/).fill("100");
  await page.getByRole("button", { name: "Automatic" }).click();
  check(await page.getByRole("dialog", { name: "Automatic orders?" }).isVisible(), "automatic mode asks first");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await wait(300);
  check(await page.getByText(/\$100 a day/).isVisible() && await page.getByText(/you approve each order/).isVisible(), "the limit is saved, approval mode kept");

  // Trading, the one place: approve a waiting order, see it in Orders; automated strategies switch on there
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  check(await page.getByRole("heading", { name: "Trading" }).isVisible(), "Safety links to Trading");
  await page.getByRole("button", { name: /^Iron condor · DEMO/ }).first().click();
  await page.getByRole("button", { name: "Approve (paper)" }).click();
  await wait(300);
  check(await page.getByText("Nothing waiting.").isVisible(), "approved: nothing left waiting");
  await page.getByRole("tab", { name: /^Orders/ }).click();
  check(await page.getByText(/Approved, checking again/).first().isVisible(), "Orders, Working, shows it approved");
  await page.getByRole("tab", { name: /^Not traded/ }).click();
  check(await page.getByText(/Refused by the limits/).first().isVisible(), "the chart's condor was checked by the rails (too much risk for $50)");
  await page.getByRole("tab", { name: "Now" }).click();
  const ic9 = page.locator(".card.strat", { hasText: "Made-up 9-day iron condor" });
  check(await ic9.getByText("Tested", { exact: true }).isVisible(), "a strategy automated from a backtest shows as tested");
  check(await ic9.getByText(/Backtest expected 51% won, \+\$31 a trade/).isVisible() && await ic9.getByText(/Paper: no closed trades yet/).isVisible(),
    "its card compares paper results with what the backtest expected");
  const sw = page.getByRole("switch", { name: /Made-up 9-day iron condor/ });
  check(await sw.getAttribute("aria-checked") === "false", "a new one starts switched off");
  await sw.click();
  check(await page.getByRole("dialog", { name: "Switch on?" }).isVisible(), "switching on asks first");
  await page.getByRole("button", { name: "Switch on", exact: true }).click();
  await wait(300);
  check(await page.getByRole("switch", { name: /Made-up 9-day iron condor on/ }).isVisible(), "and it shows as on");
  await ic9.getByRole("button").first().click();
  await page.getByRole("dialog", { name: "Automated strategy" }).getByRole("button", { name: "$2", exact: true }).click();
  check(await page.getByText(/Changed from the tested settings/).isVisible(), "changing a setting says it's no longer tested");
  await page.getByRole("dialog", { name: "Automated strategy" }).getByRole("button", { name: "Done" }).click();
  await wait(300);
  check(await ic9.getByText("Untested", { exact: true }).isVisible() && await page.getByRole("switch", { name: /Made-up 9-day iron condor off/ }).isVisible(),
    "a changed one is switched off and marked untested");
  await page.getByRole("switch", { name: /Made-up 9-day iron condor off/ }).click();
  check(await page.getByRole("dialog", { name: "Can't switch on" }).isVisible(), "an untested one can't be switched on");
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "More for automated strategies" }).click();
  await page.getByRole("menuitem", { name: "Set one up by hand (untested)" }).click();
  await page.getByRole("button", { name: /^Directional 10:30/ }).click();
  await page.getByRole("button", { name: "20", exact: true }).click();
  await page.getByRole("dialog", { name: "New automated strategy" }).getByRole("button", { name: "Done" }).click();
  await wait(300);
  check(await page.getByText(/XSP · Credit spread by direction · 10:30 · expires same day · 20 delta · \$1 wide/).isVisible(), "a hand-made one keeps its settings");

  await openFromMenu(page, "Safety and limits");
  await page.getByRole("button", { name: "Kill switch: stop all trading" }).click();
  check(await page.getByText(/Blocks every new order/).isVisible(), "the kill switch says what it does");
  await page.getByRole("button", { name: "Stop all trading", exact: true }).click();
  await wait(300);
  check(await page.getByText(/The kill switch is on/).isVisible(), "the kill switch shows as on");
  await page.getByRole("button", { name: "Turn trading back on" }).click();
  await page.getByRole("button", { name: "Turn back on" }).click();
  await wait(300);
  check(await page.getByRole("button", { name: "Kill switch: stop all trading" }).isVisible(), "trading can be turned back on");
  await page.getByRole("button", { name: "Home" }).click();

  // Today: the checklist on one page
  await page.getByRole("button", { name: "Today", exact: true }).click();
  check(await page.getByRole("heading", { name: "Today", exact: true }).isVisible(), "Today opens from the header");
  check(await page.getByText(/US market (open|closed)/).isVisible() && await page.getByText(/Sydney/).first().isVisible(), "it says whether the market is open, in Sydney time");
  check(await page.getByText("Expected move to the close").isVisible() && await page.getByText("±3.90").isVisible(), "with the latest snapshot");
  check(await page.getByText("Daily limit used").isVisible(), "and today's result against the limit");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Help: in the menu, each topic folded, terms explained
  await openFromMenu(page, "Help");
  check(await page.getByRole("heading", { name: "Help" }).isVisible(), "Help opens from the menu");
  const sections = await page.locator(".help h2").allTextContents();
  check(sections[0] === "Getting started" && sections.includes("The bot and safety") && sections.includes("When something looks wrong") && sections.at(-1) === "Terms",
    `Help starts with Getting started, then the screens, the bot, troubleshooting and terms (${sections.join(", ")})`);
  await page.getByText("Iron condor", { exact: true }).click();
  check(await page.getByText(/profits if the price stays inside a range/).isVisible(), "a term opens to its plain-English meaning");
  await page.getByRole("button", { name: "Search help" }).click();
  await page.getByRole("textbox", { name: "Search help" }).fill("kill switch");
  const found = await page.getByRole("dialog", { name: "Search help" }).locator(".helpitem summary").allTextContents();
  check(found.includes("Kill switch") && found.includes("The safety rails"), `search finds every topic that mentions it (${found.join(", ")})`);
  await page.getByRole("dialog", { name: "Search help" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Watchlists: back goes up a level, picking a symbol opens it in the tab
  await openFromMenu(page, "Watchlists");
  await page.getByRole("button", { name: /^Made-up list/ }).click();
  check(await page.getByRole("heading", { name: "Made-up list" }).isVisible(), "watchlist opens");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  check(await page.getByRole("heading", { name: "Watchlists" }).isVisible(), "back goes up to Watchlists");
  await page.getByRole("button", { name: /^Made-up list/ }).click();
  await page.getByRole("button", { name: /^TEST/ }).click();
  await page.waitForSelector("[data-testid=chart] canvas");
  check(await page.getByRole("tab", { name: /^TEST.*change the symbol/ }).isVisible(), "picking a symbol opens it on the chart");

  await page.screenshot({ path: "/tmp/sw-desktop.png" });
  await openFromMenu(page, "Chart pages");
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
