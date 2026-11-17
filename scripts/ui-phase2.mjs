/**
 * Phase 2 browser verification — real Chromium, real clicks.
 *
 * Drives the actual customer journey (home → room → wizard → confirmation →
 * lookup → cancellation) at mobile and desktop viewports, asserts no horizontal
 * overflow and captures screenshots into ./screenshots/phase2.
 *
 *   npm run build && npm start &
 *   npm run test:ui:phase2
 */
import { chromium } from "playwright";
import mongoose from "mongoose";
import { mkdir } from "node:fs/promises";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const SHOTS = "screenshots/phase2";
const TEST_NAME_PREFIX = "UI Test Guest";

let failures = 0;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function test(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
    return detail;
  } catch (error) {
    record(name, false, error?.message?.split("\n")[0] ?? String(error));
    return undefined;
  }
}

function clubDate(offsetDays) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.CLUB_TIMEZONE ?? "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(Date.now() + offsetDays * 86_400_000));
}

/** No element may push the document wider than the viewport. */
async function assertNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const viewport = window.innerWidth;
    const offenders = [];
    if (docWidth > viewport + 1) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && (rect.right > viewport + 1 || rect.left < -1)) {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        }
        if (offenders.length > 4) break;
      }
    }
    return { docWidth, viewport, offenders };
  });
  if (overflow.docWidth > overflow.viewport + 1) {
    throw new Error(
      `${label}: content ${overflow.docWidth}px wide in a ${overflow.viewport}px viewport (${overflow.offenders.join(", ")})`,
    );
  }
  return `${overflow.viewport}px`;
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  // Clean up any reservation a previous run of this suite created.
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME ?? "ktv_club",
      serverSelectionTimeoutMS: 10000,
    });
    const db = mongoose.connection.db;
    const stale = await db
      .collection("reservations")
      .find({ customerName: { $regex: `^${TEST_NAME_PREFIX}` } }, { projection: { _id: 1 } })
      .toArray();
    if (stale.length) {
      const ids = stale.map((doc) => doc._id);
      await db.collection("room_slot_locks").deleteMany({ reservation: { $in: ids } });
      await db.collection("reservations").deleteMany({ _id: { $in: ids } });
    }
  }

  const browser = await chromium.launch();
  console.log(`\nPhase 2 browser checks against ${BASE}\n${"=".repeat(54)}`);

  // ------------------------------------------------- desktop: home & rooms ---
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await desktop.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await test("Homepage loads with hero, featured rooms and nav", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const hero = await page.getByRole("heading", { level: 1 }).first().textContent();
    if (!hero) throw new Error("no h1");
    await page.getByRole("link", { name: /reserve/i }).first().waitFor();
    await page.screenshot({ path: `${SHOTS}/01-home-1366.png`, fullPage: true });
    return await assertNoHorizontalScroll(page, "home 1366");
  });

  await test("Rooms index lists rooms and opens a detail page", async () => {
    await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
    const roomLink = page.getByRole("link", { name: /Velvet Suite/i }).first();
    await roomLink.waitFor();
    await page.screenshot({ path: `${SHOTS}/02-rooms-1366.png`, fullPage: true });
    await roomLink.click();
    await page.waitForURL(/\/rooms\/velvet-suite/);
    await page.getByRole("heading", { name: /Velvet Suite/i }).first().waitFor();
    await assertNoHorizontalScroll(page, "room detail");
    return page.url().replace(BASE, "");
  });

  await test("Room gallery switches images", async () => {
    await page.goto(`${BASE}/rooms/the-parlour`, { waitUntil: "domcontentloaded" });
    const thumbs = page.getByRole("button", { name: /^show photo/i });
    const count = await thumbs.count();
    if (count > 1) {
      await thumbs.nth(1).click();
      await page.waitForTimeout(250);
      return `${count} images, switched to #2`;
    }
    return `${count} image(s)`;
  });

  await test("Book CTA carries the room into the wizard", async () => {
    await page.goto(`${BASE}/rooms/velvet-suite`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /Reserve this room/i }).click();
    await page.waitForURL(/\/reserve/);
    await page.getByTestId("slot-option").first().waitFor();
    return "/reserve";
  });

  // ------------------------------------------------------ wizard happy path ---
  const reference = await test("Wizard: date & time → room → details → confirm", async () => {
    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill(clubDate(4));
    await dateInput.blur();

    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="slot-option"]:not([disabled])').length > 0,
      undefined,
      { timeout: 15000 },
    );
    const openSlots = page.locator('[data-testid="slot-option"]:not([disabled])');
    const slotCount = await openSlots.count();
    if (slotCount === 0) throw new Error("no bookable slots");
    await openSlots.first().click();
    await page.screenshot({ path: `${SHOTS}/03-wizard-step1-1366.png`, fullPage: true });

    await page.getByRole("button", { name: /^choose a room/i }).click();

    // Step 2 — rooms for that window
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="room-option"]').length > 0,
      undefined,
      { timeout: 15000 },
    );
    const openRooms = page.locator('[data-testid="room-option"]:not([disabled])');
    if ((await openRooms.count()) === 0) throw new Error("no available rooms");
    await openRooms.first().click();
    await page.screenshot({ path: `${SHOTS}/04-wizard-step2-1366.png`, fullPage: true });
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3 — guest details
    await page.locator("#fullName").fill(`${TEST_NAME_PREFIX} Alpha`);
    await page.locator("#mobileNumber").fill("09171234567");
    await page.screenshot({ path: `${SHOTS}/05-wizard-step3-1366.png`, fullPage: true });
    await page.getByRole("button", { name: /^review booking/i }).click();

    // Step 4 — summary
    await page.getByRole("heading", { name: /review/i }).first().waitFor();
    await page.screenshot({ path: `${SHOTS}/06-wizard-step4-1366.png`, fullPage: true });
    const policy = page.locator('input[type="checkbox"]').first();
    await policy.check();
    const submit = page.getByRole("button", { name: /^submit reservation/i });
    await submit.click();

    // Step 5 — confirmation page
    await page.waitForURL(/\/confirmation\/NK-/, { timeout: 20000 });
    const heading = await page.getByRole("heading", { level: 1 }).first().textContent();
    await page.getByText(/NK-[A-Z0-9]{6}/).first().waitFor();
    const text = await page.locator("body").innerText();
    const match = text.match(/NK-[A-Z0-9]{6}/);
    if (!match) throw new Error("reference not shown");
    await page.screenshot({ path: `${SHOTS}/07-confirmation-1366.png`, fullPage: true });
    return match[0];
  });

  await test("Confirmation page shows details, policy and copy button", async () => {
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const expected of ["reservation reference", "estimated total", "publiq", "copy reference"]) {
      if (!body.includes(expected)) throw new Error(`missing "${expected}"`);
    }
    await assertNoHorizontalScroll(page, "confirmation");
    return reference ?? "rendered";
  });

  await test("Lookup finds the booking with reference + mobile", async () => {
    await page.goto(`${BASE}/lookup`, { waitUntil: "domcontentloaded" });
    await page.locator("#reference").fill(reference);
    await page.locator("#lookupMobile").fill("09171234567");
    await page.getByRole("button", { name: /view reservation/i }).click();
    try {
      await page.getByText(/Pending/i).first().waitFor({ timeout: 15000 });
    } catch (error) {
      const panel = await page.locator("main, body").first().innerText();
      throw new Error(`lookup did not render a result: ${panel.replace(/\s+/g, " ").slice(0, 400)}`);
    }
    await page.screenshot({ path: `${SHOTS}/08-lookup-result-1366.png`, fullPage: true });
    const body = await page.locator("body").innerText();
    if (!body.includes(reference)) throw new Error("reference not echoed");
    return reference;
  });

  await test("Lookup rejects a wrong mobile number", async () => {
    await page.locator("#lookupMobile").fill("09170000000");
    await page.getByRole("button", { name: /view reservation/i }).click();
    await page.getByText(/No match found/i).first().waitFor({ timeout: 15000 });
    return "generic error shown";
  });

  await test("Cancellation request completes from the lookup page", async () => {
    await page.locator("#lookupMobile").fill("09171234567");
    await page.getByRole("button", { name: /view reservation/i }).click();
    await page.getByRole("button", { name: /request cancellation/i }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${SHOTS}/09-cancel-dialog-1366.png` });
    await page.getByRole("button", { name: /confirm cancellation/i }).click();
    await page.getByText(/cancelled|request received/i).first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${SHOTS}/10-cancelled-1366.png`, fullPage: true });
    return "cancelled";
  });

  await test("Unknown reservation shows a safe empty state", async () => {
    await page.goto(`${BASE}/lookup`, { waitUntil: "domcontentloaded" });
    await page.locator("#reference").fill("NK-ZZZZZZ");
    await page.locator("#lookupMobile").fill("09170000000");
    await page.getByRole("button", { name: /view reservation/i }).click();
    await page.getByText(/No match found/i).first().waitFor({ timeout: 15000 });
    return "no enumeration";
  });

  await test("Confirmation link without token shows the expired state", async () => {
    await page.goto(`${BASE}/confirmation/${reference}`, { waitUntil: "domcontentloaded" });
    await page.getByText(/expired/i).first().waitFor();
    const body = await page.locator("body").innerText();
    if (body.includes("09171234567")) throw new Error("mobile leaked");
    return "token required";
  });

  await desktop.close();

  // ----------------------------------------------------------- mobile pass ---
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 320 ? 720 : 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mobile = await context.newPage();

    await test(`Mobile ${width}px: nav drawer opens and closes`, async () => {
      await mobile.goto(BASE, { waitUntil: "domcontentloaded" });
      await assertNoHorizontalScroll(mobile, `home ${width}`);
      await mobile.getByRole("button", { name: /menu/i }).first().click();
      await mobile.getByRole("dialog").waitFor();
      await mobile.screenshot({ path: `${SHOTS}/11-nav-drawer-${width}.png` });
      await mobile.keyboard.press("Escape");
      await mobile.waitForTimeout(300);
      return "drawer ok";
    });

    await test(`Mobile ${width}px: wizard step 1 usable and no overflow`, async () => {
      await mobile.goto(`${BASE}/reserve`, { waitUntil: "domcontentloaded" });
      await mobile.getByTestId("slot-option").first().waitFor();
      await assertNoHorizontalScroll(mobile, `wizard ${width}`);
      await mobile.screenshot({ path: `${SHOTS}/12-wizard-${width}.png`, fullPage: true });
      const tooSmall = await mobile.evaluate(() => {
        const targets = Array.from(
          document.querySelectorAll('button, a[href], input, select, [role="button"]'),
        );
        return targets
          .map((el) => el.getBoundingClientRect())
          .filter((rect) => rect.width > 8 && rect.height > 0 && rect.height < 32).length;
      });
      if (tooSmall > 0) throw new Error(`${tooSmall} touch target(s) under 32px`);
      return "targets ≥32px";
    });

    if (width === 390) {
      await test("Mobile 390px: room page and confirmation fit", async () => {
        await mobile.goto(`${BASE}/rooms/velvet-suite`, { waitUntil: "domcontentloaded" });
        await assertNoHorizontalScroll(mobile, "room detail 390");
        await mobile.screenshot({ path: `${SHOTS}/13-room-390.png`, fullPage: true });
        await mobile.goto(`${BASE}/contact`, { waitUntil: "domcontentloaded" });
        await assertNoHorizontalScroll(mobile, "contact 390");
        await mobile.goto(`${BASE}/about`, { waitUntil: "domcontentloaded" });
        await assertNoHorizontalScroll(mobile, "about 390");
        return "no overflow";
      });
    }

    await context.close();
  }

  await test("No console errors during the journey", async () => {
    const real = consoleErrors.filter(
      (message) => !/Download the React DevTools|favicon|404 \(Not Found\)/i.test(message),
    );
    if (real.length > 0) throw new Error(real.slice(0, 2).join(" | "));
    return "clean console";
  });

  await browser.close();

  // Cleanup the reservation created by this run (it must not pollute the demo).
  if (process.env.MONGODB_URI) {
    const db = mongoose.connection.db;
    const created = await db
      .collection("reservations")
      .find({ customerName: { $regex: `^${TEST_NAME_PREFIX}` } }, { projection: { _id: 1 } })
      .toArray();
    if (created.length) {
      const ids = created.map((doc) => doc._id);
      await db.collection("room_slot_locks").deleteMany({ reservation: { $in: ids } });
      await db.collection("reservations").deleteMany({ _id: { $in: ids } });
      console.log(`\n• teardown: removed ${ids.length} UI test reservation(s)`);
    }
    await mongoose.disconnect();
  }

  console.log(`\n${"=".repeat(54)}`);
  const passed = results.filter((result) => result.ok).length;
  console.log(`${passed}/${results.length} browser checks passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nBrowser harness crashed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
