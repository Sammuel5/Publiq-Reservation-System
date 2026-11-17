/**
 * Phase 3 browser verification — real Chromium, real clicks, real database.
 *
 * The API suite (scripts/test-phase3.mjs) proves what the console will accept;
 * this one proves what an operator can actually *do* with it: sign in, decline a
 * booking from a row, seat a walk-in, take money at the counter, block a night,
 * and never see a control their role cannot use. Every interaction is checked
 * against MongoDB afterwards, so a green toast that wrote nothing fails here.
 *
 *   npm run build && npm start &
 *   npm run test:ui:phase3
 *
 * Screenshots land in ./screenshots/phase3 for a human to eyeball.
 */
import { chromium } from "playwright";
import mongoose, { Types } from "mongoose";
import { mkdir, readdir } from "node:fs/promises";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const SHOTS = "screenshots/phase3";
const TZ = process.env.CLUB_TIMEZONE ?? "Asia/Manila";
const OWNER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const OWNER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const DB_NAME = process.env.MONGODB_DB_NAME ?? "ktv_club";

const RUN = String(Date.now()).slice(-6);
// A distinct documentation-network subnet keeps persistent per-IP buckets from
// coupling this run to previous browser suites. Test server must trust this header.
const TEST_IP = `198.${18 + Math.floor(Math.random() * 2)}.${1 + Math.floor(Math.random() * 253)}.7`;
const GUEST_NAME = `UI Night ${RUN}`;
const FLOOR_EMAIL = `ui-floor-${RUN}@nocturne.test`;
const FLOOR_PASSWORD = "Floor-Night-2026!";
/** Screens a Super Admin should be able to open, in sidebar order. */
const SCREENS = [
  "/admin",
  "/admin/reservations",
  "/admin/calendar",
  "/admin/rooms",
  "/admin/blocks",
  "/admin/customers",
  "/admin/payments",
  "/admin/settings",
  "/admin/team",
  "/admin/system",
];

let failures = 0;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * One wrapper for every check. A modal left open by a failed check hides the
 * rest of the page from the *next* one, so each test starts by dismissing any
 * dialog, and a failure prints where the browser actually was — without that
 * line a cascade of timeouts looks like twenty separate bugs.
 */
let activePage = null;
function usePage(page) {
  activePage = page;
}

async function test(name, fn) {
  const page = activePage;
  if (page) {
    await page.keyboard.press("Escape").catch(() => undefined);
    // A toast that is still animating shifts the layout under the next click, so
    // every check starts from a quiet page.
    await page
      .locator("[data-sonner-toast]")
      .first()
      .waitFor({ state: "hidden", timeout: 6_000 })
      .catch(() => undefined);
  }
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
    return detail;
  } catch (error) {
    let where = "";
    if (page) {
      where = ` [at ${page.url().replace(BASE, "")}] ` +
        (((await page.locator("main, body").first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim().slice(0, 150));
    }
    const why = String(error?.message ?? error).split("\n").slice(0, 7).join(" ⏎ ").replace(/\s+/g, " ");
    const writes = writeLog.slice(-2).join(" · ");
    record(name, false, why.slice(0, 380) + where + (writes ? ` ⏎ wrote: ${writes}` : ""));
    return undefined;
  }
}

const coll = (name) => mongoose.connection.db.collection(name);
const oid = (value) => new Types.ObjectId(String(value));

function clubDate(offsetDays) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

/** Money as the console prints it: peso sign and grouped decimals, no currency word. */
function money(centavos) {
  return (centavos / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Every admin write the browser makes, newest last — the first thing you want
 * when an interaction silently does nothing is the status the server answered. */
const writeLog = [];

/** Wait for a control to become clickable, and blame the right thing if it does not. */
async function saveEnabled(page, locator, what) {
  await page
    .waitForFunction(
      (text) => {
        const button = Array.from(document.querySelectorAll('button[type="submit"]')).find((el) =>
          (el.textContent ?? "").includes(text),
        );
        return !!button && !button.disabled;
      },
      "Save settings",
      { timeout: 20_000 },
    )
    .catch(async () => {
      const dirty = await page.getByText(/Unsaved changes/).count();
      throw new Error(`${what} left the save control disabled (unsaved-changes badge: ${dirty ? "shown" : "absent"})`);
    });
  await locator.waitFor({ state: "visible" });
}

/**
 * Sign in through the real form, and treat a throttled answer as retryable.
 *
 * Without this the whole suite collapses into "waiting for locator at
 * /admin/login?next=…": one spent bucket on the first check cascades into twenty
 * because nothing after it is signed in. The refusal itself is asserted in its own
 * check, so retrying here does not hide the behaviour.
 */
async function signIn(target, email, password) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await target.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
    await target.locator("#email").fill(email);
    await target.locator("#password").fill(password);
    await target.getByRole("button", { name: /^Sign in$/ }).click();
    try {
      await target.waitForURL((url) => !url.pathname.startsWith("/admin/login"), { timeout: 25_000 });
      return;
    } catch (error) {
      const said = ((await target.locator("main").textContent().catch(() => "")) ?? "");
      if (!/too many requests/i.test(said) || attempt === 6) throw error;
      console.log(`      · sign-in throttled, retrying (attempt ${attempt}/6)`);
      await target.waitForTimeout(30_000);
    }
  }
}

let phoneCounter = 0;
function freshMobile() {
  phoneCounter += 1;
  // 09 + six run digits + a three-digit counter is exactly 11: the validator is
  // strict about length, and the tail must stay unique or fixtures share a profile.
  return `09${RUN}${String(phoneCounter).padStart(3, "0")}`;
}

/**
 * No element may push the *document* wider than the viewport.
 *
 * A table inside `overflow-x-auto` is allowed to scroll on its own — that is the
 * correct answer to a wide grid on a phone — so subtrees under a scroll
 * container are skipped rather than reported as overflow.
 */
async function assertNoHorizontalScroll(page, label) {
  const measured = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const docWidth = document.documentElement.scrollWidth;
    const offenders = [];
    if (docWidth > viewport + 1) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) continue;
        if (rect.right <= viewport + 1 && rect.left >= -1) continue;
        let scrolls = false;
        for (let node = el; node && node !== document.body; node = node.parentElement) {
          const { overflowX } = getComputedStyle(node);
          if (overflowX === "auto" || overflowX === "scroll") {
            scrolls = true;
            break;
          }
        }
        if (scrolls) continue;
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        if (offenders.length > 4) break;
      }
    }
    return { docWidth, viewport, offenders };
  });
  if (measured.docWidth > measured.viewport + 1) {
    throw new Error(
      `${label}: content ${measured.docWidth}px wide in a ${measured.viewport}px viewport (${measured.offenders.join(", ")})`,
    );
  }
  return `${label} fits ${measured.viewport}px`;
}

/** Sign in through the JSON endpoint to get a cookie for fixture writes. */
async function apiLogin(email, password) {
  let response = null;
  // Login is rate limited per address (10 / 15 min) and per email (8 / 15 min), in
  // memory. A fixture that signs in a handful of times must not fail because an
  // earlier suite spent the bucket, so a throttled answer is retried briefly.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    response = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, "X-Forwarded-For": TEST_IP },
      body: JSON.stringify({ email, password }),
    });
    if (response.status !== 429) break;
    if (attempt < 6) {
      console.log(`      · login throttled, retrying (attempt ${attempt}/6)`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
  if (!response.ok) throw new Error(`fixture login failed: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}

async function api(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

/** The real walk-in payload: the room slug and the night the operator picks. */
async function seatParty(cookie, overrides = {}) {
  const { status, body } = await api("/api/admin/reservations", {
    cookie,
    method: "POST",
    body: {
      roomSlug: "the-parlour",
      date: clubDate(15),
      startTime: "20:00",
      durationMinutes: 120,
      fullName: GUEST_NAME,
      mobileNumber: freshMobile(),
      email: `ui-${RUN}@nocturne.test`,
      guestCount: 6,
      specialRequests: "Two microphones and a birthday cake",
      confirmNow: false,
      ...overrides,
    },
  });
  if (status !== 200) throw new Error(`fixture booking failed: ${status} ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

async function findByReference(reference) {
  return coll("reservations").findOne({ reservationReference: reference });
}

async function main() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) throw new Error("SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD are required");
  await mkdir(SHOTS, { recursive: true });
  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 10_000 });

  // Sweep what an interrupted UI run left behind. The markers are deliberately
  // stable across runs — a per-run token would make every crash permanent, and a
  // crashed fixture on the demo night blocks the next run's booking with a 409.
  // A reservation only stores an ObjectId in `customer`, so the name has to be
  // resolved through the profiles collection first — querying `customer.fullName`
  // on the booking matches nothing and quietly makes a sweep a no-op.
  const GUEST_MATCH = /^UI (Night|Walkin) /;
  const staleProfiles = await coll("customers").find({ fullName: GUEST_MATCH }, { projection: { _id: 1 } }).toArray();
  const stale = staleProfiles.length
    ? await coll("reservations").find({ customer: { $in: staleProfiles.map((doc) => doc._id) } }).toArray()
    : [];
  const staleIds = stale.map((doc) => doc._id);
  const swept = [];
  if (staleIds.length) {
    swept.push(`${(await coll("room_slot_locks").deleteMany({ reservation: { $in: staleIds } })).deletedCount} lock(s)`);
    await coll("payments").deleteMany({ reservation: { $in: staleIds } });
    swept.push(`${(await coll("reservations").deleteMany({ _id: { $in: staleIds } })).deletedCount} booking(s)`);
  }
  swept.push(`${(await coll("customers").deleteMany({ fullName: GUEST_MATCH })).deletedCount} profile(s)`);
  swept.push(`${(await coll("room_blocks").deleteMany({ reason: /^UI private hire / })).deletedCount} block(s)`);
  swept.push(`${(await coll("rooms").deleteMany({ name: /^UI Booth / })).deletedCount} room(s)`);
  const staleAccounts = await coll("admin_users").find({ email: /^ui-floor-\d+@nocturne\.test$/ }, { projection: { _id: 1 } }).toArray();
  await coll("admin_sessions").deleteMany({ user: { $in: staleAccounts.map((doc) => doc._id) } });
  swept.push(`${(await coll("admin_users").deleteMany({ _id: { $in: staleAccounts.map((doc) => doc._id) } })).deletedCount} account(s)`);
  console.log(`\n• sweep: ${swept.join(", ")} from earlier runs`);

  const fixtures = { references: [], blockIds: [], roomIds: [], adminIds: [], customerIds: [], paymentIds: [] };
  const cookie = await apiLogin(OWNER_EMAIL, OWNER_PASSWORD);
  const pending = await seatParty(cookie);
  const pendingRef = pending.reference;

  const browser = await chromium.launch();
  console.log(`\nPhase 3 browser checks against ${BASE}\n${"=".repeat(54)}`);

  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": TEST_IP } });
  desktop.setDefaultTimeout(45_000);
  const page = await desktop.newPage();
  usePage(page);
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "GET" || !request.url().includes("/api/admin/")) return;
    response
      .text()
      .then((body) => {
        writeLog.push(`${request.method()} ${request.url().replace(BASE, "")} → ${response.status()} ${body.slice(0, 150)}`);
      })
      .catch(() => writeLog.push(`${request.method()} ${request.url().replace(BASE, "")} → ${response.status()}`));
  });

  // ------------------------------------------------------------------ login --
  await test("The login screen refuses a bad password without signing anyone in", async () => {
    await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(OWNER_EMAIL);
    await page.locator("#password").fill("wrong-passwordentirely");
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    const refusal = page
      .locator("[data-sonner-toast], [role=alert]")
      .filter({ hasText: /incorrect|invalid|wrong|locked|too many|try again/i })
      .first();
    await refusal.waitFor({ timeout: 20_000 });
    const said = ((await refusal.textContent()) ?? "").replace(/\s+/g, " ").trim();
    if (!said) throw new Error("the refusal was empty");
    if (/too many requests/i.test(said)) throw new Error("rate limit prevented the bad-password check; retry with a fresh login bucket");
    if (!page.url().includes("/admin/login")) throw new Error("a failed sign-in still navigated into the console");
    return `refused with “${said.slice(0, 60)}”`;
  });

  await test("Signing in lands on the shift overview and greets the operator", async () => {
    await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.getByRole("heading", { name: /Tonight ·/ }).first().waitFor({ timeout: 20_000 });
    await page.getByText(/Welcome back/).first().waitFor();
    await page.screenshot({ path: `${SHOTS}/01-dashboard-1366.png`, fullPage: true });
    return page.url().replace(BASE, "");
  });

  await test("The sidebar offers a Super Admin all ten sections, none of them “coming soon”", async () => {
    const nav = page.getByRole("navigation", { name: "Admin sections" });
    const links = await nav.locator("a").allTextContents();
    const labels = links.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (labels.length < 10) throw new Error(`only ${labels.length} nav item(s): ${labels.join(", ")}`);
    for (const wanted of ["Reservations", "Night grid", "Rooms", "Blocked dates", "Customers", "Payments", "Settings", "Team", "System"]) {
      if (!labels.some((label) => label.startsWith(wanted))) throw new Error(`the sidebar is missing ${wanted}`);
    }
    const body = (await page.locator("body").textContent()) ?? "";
    if (/coming soon|not implemented|phase 3\b/i.test(body)) throw new Error("a shipped screen still announces itself as unfinished");
    return `${labels.length} sections`;
  });

  await test("Every console screen renders for the right account without a console error", async () => {
    const seen = [];
    for (const path of SCREENS) {
      const startErrors = consoleErrors.length;
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 20_000 });
      const status = await page.evaluate(() => document.title);
      if (!status) throw new Error(`${path} has no document title`);
      const fresh = consoleErrors.slice(startErrors).filter((text) => !/favicon|ResizeObserver/.test(text));
      if (fresh.length) throw new Error(`${path} logged ${fresh.length} error(s): ${fresh[0].slice(0, 120)}`);
      seen.push(path);
    }
    await page.goto(`${BASE}/admin/reservations`, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: `${SHOTS}/02-board-1366.png`, fullPage: true });
    return `${seen.length} screens clean`;
  });

  await test("No icon-only control is silent to a screen reader", async () => {
    const offenders = [];
    for (const path of SCREENS) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      const found = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button, a[role=button]"))
          .filter((el) => !String(el.textContent ?? "").trim())
          .filter((el) => !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.querySelector("[aria-hidden=false]"))
          .map((el) => `${path} · ${el.className.toString().slice(0, 44) || el.tagName.toLowerCase()}`),
      );
      offenders.push(...found);
    }
    if (offenders.length) throw new Error(`${offenders.length} unnamed control(s): ${offenders.slice(0, 3).join(" | ")}`);
    return `${SCREENS.length} screens scanned`;
  });

  // ------------------------------------------------------------------- board --
  await test("The board's search is a plain form, so a filtered view can be bookmarked", async () => {
    await page.goto(`${BASE}/admin/reservations?view=all`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="q"]').fill(pendingRef);
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await page.waitForURL(/q=/, { timeout: 15_000 });
    const url = new URL(page.url());
    if (url.searchParams.get("q") !== pendingRef) throw new Error(`query string was ${url.search}`);
    await page.getByText(pendingRef).first().waitFor({ timeout: 15_000 });
    const rows = await page.locator("table tbody tr").count();
    if (rows !== 1) throw new Error(`the search returned ${rows} rows, expected the one fixture`);
    return `${url.search.slice(0, 48)} → 1 row`;
  });

  await test("A pending booking is declined from its row, with the reason on the timeline", async () => {
    await page.getByRole("button", { name: "Decline" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    // The reason is not optional: refuse the click, then supply it.
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /say why/i }).first().waitFor({ timeout: 10_000 });
    const doc0 = await findByReference(pendingRef);
    if (doc0.status !== "PENDING") throw new Error("an empty reason still declined the booking");

    await dialog.locator("textarea").fill("No answer on the mobile number given");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /declin|rejected|released/i }).first().waitFor({ timeout: 20_000 });
    const doc = await findByReference(pendingRef);
    if (doc.status !== "REJECTED") throw new Error(`the booking is ${doc.status}`);
    const entry = (doc.statusHistory ?? []).at(-1);
    if (!/No answer on the mobile/i.test(entry?.reason ?? "")) throw new Error(`the timeline lost the reason: ${entry?.reason}`);
    if (!entry?.changedBy) throw new Error("the timeline does not say who declined it");
    await page.screenshot({ path: `${SHOTS}/03-declined.png` });
    return "empty reason refused · REJECTED with the reason and the actor";
  });

  // ---------------------------------------------------------------- walk-in ---
  await test("Walk-in: the counter form seats a party and the server sets the price", async () => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New booking", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();

    // Escape must get an operator out of a half-filled form, focus and all.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    if (!/new booking/i.test(focused)) throw new Error(`Escape left focus on “${focused}” instead of the trigger`);

    await page.getByRole("button", { name: "New booking", exact: true }).click();
    const roomValue = await dialog
      .locator("#walkin-room")
      .evaluate((el) => Array.from(el.options).map((option) => option.value).find(Boolean));
    if (!roomValue) throw new Error("the walk-in form offers no room to book");
    await dialog.locator("#walkin-room").selectOption(roomValue);
    await dialog.locator("#walkin-date").fill(clubDate(15));
    await dialog.locator("#walkin-name").fill(`UI Walkin ${RUN}`);
    await dialog.locator("#walkin-mobile").fill(freshMobile());
    await dialog.locator("#walkin-guests").fill("4");
    await dialog.locator("#walkin-time").selectOption("21:00");
    await dialog.locator("#walkin-duration").fill("120");
    await dialog.locator('label:has-text("Confirm immediately") input[type="checkbox"]').check();
    await dialog.locator('form button[type="submit"]').click();
    await dialog.getByText(/created ·/).first().waitFor({ timeout: 20_000 });
    const text = (await dialog.getByText(/created ·/).first().textContent()) ?? "";
    const reference = (text.match(/NK-[A-Z0-9]{6}/) ?? [""])[0];
    if (!reference) throw new Error(`no reference in the confirmation panel: ${text}`);
    fixtures.references.push(reference);

    const doc = await findByReference(reference);
    if (!doc) throw new Error(`${reference} was never written`);
    if (doc.status !== "CONFIRMED") throw new Error(`a counter booking is ${doc.status}`);
    const room = await coll("rooms").findOne({ _id: doc.room });
    const expected = Math.round((room.hourlyRate * doc.durationMinutes) / 60);
    if (doc.estimatedAmount !== expected) throw new Error(`charged ${doc.estimatedAmount}, the room says ${expected}`);
    if (!text.includes(money(doc.estimatedAmount))) throw new Error("the panel did not show the price it charged");
    await page.screenshot({ path: `${SHOTS}/04-walkin.png` });
    return `${reference} · ₱${money(doc.estimatedAmount)} · priced from ${room.slug}`;
  });

  // ------------------------------------------------------------- detail page --
  const walkinRef = fixtures.references[0] ?? pendingRef;
  const walkinDoc = walkinRef ? await findByReference(walkinRef) : null;
  const bookingUrl = walkinDoc ? `/admin/reservations/${String(walkinDoc._id)}` : "/admin/reservations";

  await test("The booking page's tabs switch panels without a navigation", async () => {
    await page.goto(`${BASE}${bookingUrl}`, { waitUntil: "domcontentloaded" });
    const startUrl = page.url();
    const expect = [
      ["Guest", /Guest details/i],
      ["Money", /Balance/i],
      ["Move", /Room|Date/i],
      ["Notes", /Internal notes/i],
    ];
    for (const [tab, needle] of expect) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const selected = await page.getByRole("tab", { name: tab, exact: true }).getAttribute("aria-selected");
      if (selected !== "true") throw new Error(`${tab} did not become the selected tab`);
      const body = (await page.locator("main").textContent()) ?? "";
      if (!needle.test(body)) throw new Error(`${tab}'s panel did not show ${needle}`);
    }
    if (page.url() !== startUrl) throw new Error("switching a tab navigated the page");
    await page.screenshot({ path: `${SHOTS}/05-booking-tabs.png`, fullPage: true });
    return "4 tabs, no navigation";
  });

  await test("A note typed at the desk reaches the timeline with its author", async () => {
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    const note = `Late arrival promised — hold the set list short. [${RUN}]`;
    await page.locator("#note-body").fill(note);
    await page.locator('form:has(#note-body) button[type="submit"]').click();
    let doc = await findByReference(walkinRef);
    let notes = (doc.internalNotes ?? []).map((entry) => entry.body);
    for (let attempt = 0; attempt < 24 && !notes.some((body) => body.includes(RUN)); attempt += 1) {
      await page.waitForTimeout(250);
      doc = await findByReference(walkinRef);
      notes = (doc.internalNotes ?? []).map((entry) => entry.body);
    }
    await page.getByText(note.slice(0, 32)).first().waitFor({ timeout: 10_000 });
    const stored = notes.find((body) => body.includes(RUN)) ? (doc.internalNotes ?? []).at(-1) : null;
    void notes;
    if (!stored) throw new Error(`the note is not on the document (${notes.length} note(s): ${notes.join(" / ").slice(0, 90)})`);
    if (!stored.author) throw new Error("the note is not attributed");
    const author = await coll("admin_users").findOne({ _id: oid(stored.author) });
    const body = (await page.locator("main").textContent()) ?? "";
    const first = (author?.name ?? "").split(" ")[0];
    if (!first || !body.includes(first)) {
      throw new Error(`the console never named the author (${author?.name ?? "unknown"}) on the note`);
    }
    return `noted by ${author.name} on the timeline`;
  });

  await test("Money taken at the counter appears in the ledger and closes the balance", async () => {
    const before = await findByReference(walkinRef);
    const deposit = Math.round(before.estimatedAmount / 2);
    await page.getByRole("tab", { name: "Money", exact: true }).click();
    await page.locator("#pay-amount").fill((deposit / 100).toFixed(2));
    await page.locator("#pay-method").selectOption("CASH");
    await page.locator('form:has(#pay-amount) button[type="submit"]').click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /recorded|payment|saved/i }).first().waitFor({ timeout: 20_000 });

    const doc = await findByReference(walkinRef);
    const payment = await coll("payments").findOne({ reservation: doc._id });
    if (!payment) throw new Error("no receipt was written");
    if (payment.amount !== deposit) throw new Error(`receipt of ${payment.amount}, asked for ${deposit}`);
    if (!payment.recordedBy) throw new Error("the receipt does not say who took the money");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Money", exact: true }).click();
    const body = (await page.locator("main").textContent()) ?? "";
    const outstanding = doc.estimatedAmount - payment.amount;
    if (!body.includes(money(outstanding))) throw new Error(`the page still shows a balance other than ₱${money(outstanding)}`);
    if (!body.includes(money(deposit))) throw new Error("the receipt is not visible on the page");
    await page.screenshot({ path: `${SHOTS}/06-money.png`, fullPage: true });
    return `₱${money(deposit)} in · ₱${money(outstanding)} outstanding`;
  });

  await test("Over-collecting is refused, and a mistaken entry can be taken back off the ledger", async () => {
    const doc0 = await findByReference(walkinRef);
    const receipts0 = await coll("payments").countDocuments({ reservation: doc0._id });
    await page.getByRole("tab", { name: "Money", exact: true }).click();
    await page.locator("#pay-amount").fill(((doc0.estimatedAmount + 500_00) / 100).toFixed(2));
    await page.locator('form:has(#pay-amount) button[type="submit"]').click();
    const toast = page
      .locator("[data-sonner-toast], main [role=alert]")
      .filter({ hasText: /more than|outstanding|balance|exceed|collect/i })
      .first();
    await toast.waitFor({ timeout: 20_000 });
    const doc = await findByReference(walkinRef);
    const receipts = await coll("payments").countDocuments({ reservation: doc._id });
    if (receipts !== receipts0) throw new Error(`the refusal still wrote a receipt (${receipts0} → ${receipts})`);
    const refused = (await toast.textContent())?.trim().slice(0, 70) ?? "refused";

    // Now the rarer case: the entry itself was a mistake, so the console has to be
    // able to remove it. That control must use the verb the endpoint answers — a
    // POST to a DELETE-only route is a 405 that looks exactly like a dead button.
    await page.locator("#pay-amount").fill("10.00");
    await page.locator('form:has(#pay-amount) button[type="submit"]').click();
    await page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /recorded|payment|saved/i })
      .first()
      .waitFor({ timeout: 20_000 });
    const doc2 = await findByReference(walkinRef);
    const extra = await coll("payments").findOne({ reservation: doc2._id, amount: 1000 });
    if (!extra) throw new Error("the mistaken entry was never written, so there was nothing to remove");
    fixtures.paymentIds.push(extra._id);
    // Two receipts are on screen now, so the control must be found on the right
    // row: clicking the first "Remove" would take the guest's real deposit.
    const bogusRow = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: "Remove", exact: true }) })
      .filter({ hasText: `₱${money(1000)}` });
    await bogusRow.first().waitFor({ state: "visible", timeout: 20_000 });
    if ((await bogusRow.count()) !== 1) {
      throw new Error(`${await bogusRow.count()} rows matched the ₱10 entry, so the ledger does not tell its rows apart`);
    }
    await bogusRow.first().getByRole("button", { name: "Remove", exact: true }).click();
    const removal = page.getByRole("dialog").filter({ hasText: /Remove this entry/ });
    await removal.waitFor({ timeout: 15_000 });
    if (await removal.locator("textarea").count()) {
      throw new Error("the removal dialog collects a reason the endpoint cannot store");
    }
    await removal.getByRole("button", { name: "Confirm" }).click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /removed/i }).first().waitFor({ timeout: 20_000 });
    if (await coll("payments").countDocuments({ _id: extra._id })) throw new Error("the entry survived a successful removal");
    if (await coll("payments").countDocuments({ reservation: doc2._id }) !== receipts0) {
      throw new Error("the ledger did not return to the size it had before the mistake");
    }
    // The deposit that was *not* a mistake has to be untouched — a removal that took
    // the wrong row would still answer 200.
    const deposit = await coll("payments").findOne({ reservation: doc2._id, amount: { $ne: 1000 } });
    if (!deposit) throw new Error("the real deposit went missing alongside the mistaken entry");
    // Wait for the refreshed ledger, not just the success toast.
    await bogusRow.waitFor({ state: "hidden", timeout: 20_000 });
    await page.locator("li").filter({ hasText: `₱${money(deposit.amount)}` })
      .getByRole("button", { name: "Remove", exact: true }).waitFor({ timeout: 20_000 });
    fixtures.paymentIds = fixtures.paymentIds.filter((value) => String(value) !== String(extra._id));
    return `refused: ${refused} · ₱10.00 removed, ₱${money(deposit.amount)} deposit intact`;
  });

  // ------------------------------------------------------------ guests & rooms --
  await test("A guest profile can be searched, annotated and read back after a reload", async () => {
    await page.goto(`${BASE}/admin/customers?q=${RUN}`, { waitUntil: "domcontentloaded" });
    const link = page.locator("a[href^='/admin/customers/']").first();
    const found = await page.locator("table tbody tr").count();
    if (found === 0) throw new Error(`no profile matched ${RUN}`);
    await link.waitFor({ timeout: 20_000 });
    await link.click();
    await page.waitForURL(/\/admin\/customers\/[0-9a-f]{24}/, { timeout: 20_000 });
    const note = `Prefers the corner booth · always pays GCash [${RUN}]`;
    await page.locator("#cust-notes").fill(note);
    await page.locator('form:has(#cust-notes) button[type="submit"]').click();
    await page.waitForTimeout(1_200);
    const profileId = page.url().match(/customers\/([0-9a-f]{24})/)?.[1] ?? "000000000000000000000000";
    const savedProfile = await coll("customers").findOne({ _id: oid(profileId) });
    if (!savedProfile || !String(savedProfile.notes ?? "").includes(RUN)) {
      const said = await page
        .locator("[role=alert], [data-sonner-toast]")
        .allTextContents()
        .catch(() => []);
      throw new Error(
        `the note never reached the profile (stored ${JSON.stringify(savedProfile?.notes ?? null)}, page said ${JSON.stringify(said).slice(0, 160)})`,
      );
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    if ((await page.locator("#cust-notes").inputValue()) !== note) throw new Error("the note did not survive a reload");
    const customerId = page.url().match(/customers\/([0-9a-f]{24})/)?.[1];
    if (customerId) fixtures.customerIds.push(oid(customerId));
    const body = (await page.locator("main").textContent()) ?? "";
    if (!/visit|booking/i.test(body)) throw new Error("the profile does not summarise the guest's history");
    await page.screenshot({ path: `${SHOTS}/07-guest.png`, fullPage: true });
    return "profile readable without the lookup token";
  });

  await test("Rooms: a new room appears in the console and on the public site at once", async () => {
    await page.goto(`${BASE}/admin/rooms`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New room" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const name = `UI Booth ${RUN}`;
    const category = await dialog
      .locator("#room-category")
      .evaluate((el) => Array.from(el.options).map((option) => option.value).find(Boolean));
    if (!category) throw new Error("the room form has no category to pick — create one first");
    await dialog.locator("#room-name").fill(name);
    await dialog.locator("#room-capacity").fill("8");
    await dialog.locator("#room-rate").fill("-1");
    await dialog.locator("#room-category").selectOption(category);
    await dialog.locator('form button[type="submit"]').click();
    // A negative rate is nonsense the browser's number widget cannot catch, so the
    // server must refuse it and name the field — otherwise the price is trusted.
    await page.locator("[data-sonner-toast], [role=alert]").filter({ hasText: /rate|amount|must|invalid|positive/i }).first().waitFor({ timeout: 20_000 });
    if (await coll("rooms").findOne({ name })) throw new Error("a room with a negative rate was created");
    if ((await dialog.locator("#room-rate").getAttribute("aria-invalid")) !== "true") {
      throw new Error("the refusal did not point at the rate field");
    }
    await dialog.locator("#room-rate").fill("1500");
    await dialog.locator("#room-min").fill("60");
    await dialog.locator("#room-grid").fill("30");
    await dialog.locator('form button[type="submit"]').click();
    // Rooms are listed as draggable rows keyed by slug (`data-room-row`), not table
    // rows — and the point of the check is that the *page* picks the new room up
    // without a manual reload.
    const row = page.locator(`[data-room-row="ui-booth-${RUN}"]`);
    await row
      .waitFor({ timeout: 20_000 })
      .catch(async () => {
        const said = await page.locator("[role=alert], [data-sonner-toast]").allTextContents().catch(() => []);
        const rows = await page.locator("[data-room-row]").count();
        throw new Error(`the new room is not on the page (${rows} row(s) listed; alerts: ${JSON.stringify(said).slice(0, 200)})`);
      });
    if (!(await row.getByText(name).count())) throw new Error("the room row exists but does not name the room");
    const stored = await coll("rooms").findOne({ name });
    if (!stored) throw new Error("the room is on the page but not in the database");
    // "Generated from the name if blank" is a promise the server has to keep.
    if (stored.slug !== `ui-booth-${RUN}`.toLowerCase().replace(/[^a-z0-9-]/g, "")) {
      throw new Error(`a blank slug was not derived from the name (stored “${stored.slug}”)`);
    }
    fixtures.roomIds.push(stored._id);
    await page.screenshot({ path: `${SHOTS}/08-rooms.png`, fullPage: true });

    const publicPage = await desktop.newPage();
    await publicPage.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
    if (!(await publicPage.getByText(name).first().isVisible().catch(() => false))) {
      throw new Error("the public rooms page did not pick the new room up");
    }
    await publicPage.close();

    // An empty room is deletable — the console must say so rather than shrug.
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /delet|removed/i }).first().waitFor({ timeout: 20_000 });
    if (await coll("rooms").findOne({ _id: stored._id })) throw new Error("the row stayed after a successful delete");
    fixtures.roomIds = fixtures.roomIds.filter((value) => String(value) !== String(stored._id));
    return `${name} created → sold on the site → deleted`;
  });

  // ------------------------------------------------------------------ blocks --
  await test("Blocks: one window closes the venue, Reopen puts the night back on sale", async () => {
    await page.goto(`${BASE}/admin/blocks?from=${clubDate(0)}&to=${clubDate(30)}`, { waitUntil: "domcontentloaded" });
    // The blocks form opens inline — a form on the page, not a modal, because the
    // list behind it has to stay readable while you pick a window.
    await page.getByRole("button", { name: "Block a window" }).click();
    const form = page.locator("form:has(#block-date)");
    await form.waitFor({ timeout: 15_000 });
    const date = clubDate(8);
    await form.locator("#block-date").fill(date);
    await form.locator("#block-start").selectOption("20:00");
    await form.locator("#block-end").selectOption("23:00");
    await form.locator("#block-reason").fill(`UI private hire ${RUN}`);
    await form.locator('button[type="submit"]').click();
    // The list of windows is server-rendered, so the new row has to arrive in the
    // same `li` that carries its Close control — waiting for the text anywhere on
    // the page would also be satisfied by the form you just typed it into.
    const blockRow = page.locator("li", { hasText: `UI private hire ${RUN}` }).first();
    await blockRow
      .getByRole("button", { name: /Close window|Reopen/ })
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(async () => {
        const rows = await page.locator("li").count();
        const empty = await page.getByText(/Nothing is blocked/i).count();
        const said = await page.locator("[role=alert], [data-sonner-toast]").allTextContents().catch(() => []);
        throw new Error(
          `the new window is not in the list (${rows} row(s), empty-state shown: ${empty ? "yes" : "no"}; alerts: ${JSON.stringify(said).slice(0, 160)})`,
        );
      });
    const block = await coll("room_blocks").findOne({ reason: `UI private hire ${RUN}` });
    if (!block) throw new Error("the window is on the page but not in the database");
    fixtures.blockIds.push(block._id);
    if (block.room) throw new Error("a venue-wide block pinned a room");

    const publicPage = await desktop.newPage();
    await publicPage.goto(`${BASE}/reserve?date=${date}&startTime=21:00`, { waitUntil: "domcontentloaded" });
    const soldOut = await publicPage.getByText(/no rooms|fully booked|sold out|closed/i).first().isVisible().catch(() => false);
    const availability = await api(`/api/availability?date=${date}&startTime=21:00&duration=120`, {});
    const bookable = (availability.body?.rooms ?? []).filter((room) => room.available).length;
    if (!soldOut && bookable > 0) throw new Error(`the blocked night still had ${bookable} bookable room(s)`);
    await publicPage.close();

    // "Close window" is the control an operator reaches for first: it has to close.
    await page.locator("li", { hasText: `UI private hire ${RUN}` }).first().getByRole("button", { name: /Close window/ }).click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /window closed/i }).first().waitFor({ timeout: 20_000 });
    const closed = await coll("room_blocks").findOne({ _id: block._id });
    if (closed.isActive !== false) throw new Error("Close window left the block in force");
    if (!closed.closedBy || !closed.closedAt) throw new Error("the closure was not stamped with who and when");
    // `router.refresh()` settles a beat after the toast, so the row is polled rather
    // than read once — and the badge is what an operator judges the state from.
    const closedRow = page.locator("li", { hasText: `UI private hire ${RUN}` }).first();
    await closedRow.getByText("Closed", { exact: true }).waitFor({ timeout: 20_000 });
    const relisted = await closedRow.textContent();
    if (!/Closed/.test(relisted ?? "")) {
      throw new Error(`the row still does not say it is closed (“${(relisted ?? "").replace(/\s+/g, " ").slice(0, 100)}”)`);
    }

    const after = await api(`/api/availability?date=${date}&startTime=21:00&duration=120`, {});
    const freed = (after.body?.rooms ?? []).filter((room) => room.available).length;
    if (freed === 0) throw new Error("closing the window did not put the night back on sale");

    await page.locator("li", { hasText: `UI private hire ${RUN}` }).first().getByRole("button", { name: /Reopen/ }).click();
    await page.locator("[data-sonner-toast]").filter({ hasText: /reopened/i }).first().waitFor({ timeout: 20_000 });
    const reopened = await coll("room_blocks").findOne({ _id: block._id });
    if (reopened.isActive !== true) throw new Error("the window stayed closed after a reopen");
    if (reopened.closedBy || reopened.closedAt) throw new Error("reopening left the closure stamp behind");
    await page.screenshot({ path: `${SHOTS}/09-blocks.png`, fullPage: true });
    return `${date} blocked → closed (stamped) → night on sale → reopened`;
  });

  // --------------------------------------------------------------- payments ----
  await test("Payments: filtering to one method must not change the night's takings", async () => {
    const all = await api("/api/admin/payments", { cookie });
    const collected = all.body.totals.collected;
    await page.goto(`${BASE}/admin/payments`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 20_000 });
    const beforeText = (await page.locator("main").textContent()) ?? "";
    if (!beforeText.includes(money(collected))) throw new Error("the page does not show the window's collected figure");

    await page.locator('select[name="method"]').selectOption("CASH");
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await page.waitForURL(/method=CASH/, { timeout: 15_000 });
    const afterText = (await page.locator("main").textContent()) ?? "";
    if (!afterText.includes(money(collected))) {
      throw new Error("filtering the ledger to CASH changed the takings — the screen now lies about the night");
    }
    const cashRows = await page.locator("table tbody tr").count();
    if (cashRows === 0) throw new Error("the CASH filter hid every receipt, including the one this run took");
    const filtered = await api("/api/admin/payments?method=CASH", { cookie });
    if (filtered.body.totals.collected !== collected) {
      throw new Error(`the API agrees with the page's mistake: ₱${money(filtered.body.totals.collected)} ≠ ₱${money(collected)}`);
    }
    await page.screenshot({ path: `${SHOTS}/10-payments.png`, fullPage: true });
    return `₱${money(collected)} in the window, ${cashRows} CASH receipt(s) shown`;
  });

  // ------------------------------------------------------------- settings -----
  await test("Settings: a bad value is caught where it was typed, and a good one reports its diff", async () => {
    await page.goto(`${BASE}/admin/settings`, { waitUntil: "domcontentloaded" });
    const tagline = page.locator("#set-tagline");
    const clubName = page.locator("#set-name");
    const original = await tagline.inputValue();
    const originalName = await clubName.inputValue();

    await clubName.fill("");
    const save = page.getByRole("button", { name: /Save settings/ });
    const enabled = await save.isEnabled().catch(() => false);
    if (!enabled) {
      const unsaved = await page.getByText(/Unsaved changes/).count();
      const value = await clubName.inputValue();
      throw new Error(`the save control stayed disabled (field reads “${value}”, unsaved badge: ${unsaved ? "shown" : "absent"}) — a form that will not submit cannot report its own errors`);
    }
    await save.click();
    // Either the browser's own `required` rule or the server's field map may stop
    // this — what matters is that the operator is told *on the field*, and that
    // nothing is written.
    await page
      .waitForFunction(() => {
        const el = document.querySelector("#set-name");
        return el?.getAttribute("aria-invalid") === "true" || (el instanceof HTMLInputElement && el.matches(":invalid"));
      }, { timeout: 15_000 })
      .catch(() => undefined);
    const flagged = await page.evaluate(() => {
      const el = document.querySelector("#set-name");
      return el?.getAttribute("aria-invalid") === "true" || (el instanceof HTMLInputElement && el.matches(":invalid"));
    });
    if (!flagged) throw new Error("a nameless club was not flagged on the field");
    const untouched = await coll("club_settings").findOne({});
    if (untouched.clubName !== originalName) throw new Error("a rejected save rewrote the document anyway");
    await clubName.fill(originalName);

    const replacement = `Signature nights, booked in seconds · ${RUN}`;
    await tagline.fill(replacement);
    await saveEnabled(page, save, "the tagline change");
    await save.click();
    await page.getByText(/Saved — 1 value/).first().waitFor({ timeout: 20_000 });
    if ((await coll("club_settings").findOne({}))?.tagline !== replacement) throw new Error("the save did not land");
    await page.screenshot({ path: `${SHOTS}/11-settings.png`, fullPage: true });

    // Reverting has to be saveable too: the form compares itself against the
    // settings it was rendered with, so the baseline must move after a save.
    await tagline.fill(original);
    await saveEnabled(page, save, "the revert");
    // The previous "Saved" card is still visible; wait for this PUT rather than
    // mistaking the earlier success message for the revert's completion.
    const revertResponse = page.waitForResponse((response) => response.url().includes("/api/admin/settings") && response.request().method() === "PUT", { timeout: 20_000 });
    await save.click();
    const reverted = await revertResponse;
    if (!reverted.ok()) throw new Error(`the revert was rejected (${reverted.status()})`);
    if ((await coll("club_settings").findOne({}))?.tagline !== original) {
      throw new Error("the revert did not land — the club kept the test tagline");
    }
    return "validated on the field · diff reported · reverted";
  });

  // ------------------------------------------------------------------ team ----
  await test("Team: my row is marked, and a weak password is refused before it is hashed", async () => {
    await page.goto(`${BASE}/admin/team`, { waitUntil: "domcontentloaded" });
    const marked = page.locator("table").getByText("You", { exact: true }).first();
    await marked.waitFor({ timeout: 20_000 });
    if (!(await page.getByText(OWNER_EMAIL).first().count())) throw new Error("the list did not show my own address");
    await page.getByRole("button", { name: "Add account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.locator("#account-name").fill(`UI Floor ${RUN}`);
    await dialog.locator("#account-email").fill(FLOOR_EMAIL);
    await dialog.locator("#account-password").fill("short");
    await dialog.locator('form button[type="submit"]').click();
    await dialog.getByRole("alert").filter({ hasText: /12 characters/i }).first().waitFor({ timeout: 15_000 });
    if (await coll("admin_users").findOne({ email: FLOOR_EMAIL })) throw new Error("a weak password still created the account");
    await page.screenshot({ path: `${SHOTS}/12-team.png`, fullPage: true });

    // Same dialog, good password: this account is the one used for the role checks.
    await dialog.locator("#account-password").fill(FLOOR_PASSWORD);
    await dialog.locator('form button[type="submit"]').click();
    await page.getByText(FLOOR_EMAIL).first().waitFor({ timeout: 20_000 });
    const created = await coll("admin_users").findOne({ email: FLOOR_EMAIL });
    if (!created) throw new Error("the account was listed but not written");
    fixtures.adminIds.push(created._id);
    if (created.passwordHash === FLOOR_PASSWORD) throw new Error("the password was stored in the clear");
    return "weak password refused on the field · Staff account created";
  });

  // ------------------------------------------------------- the floor's view ---
  await test("The floor sees a smaller console, and cannot reach the parts that are not theirs", async () => {
    const floor = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": TEST_IP } });
    const floorPage = await floor.newPage();
    await signIn(floorPage, FLOOR_EMAIL, FLOOR_PASSWORD);

    const labels = (await floorPage.getByRole("navigation", { name: "Admin sections" }).locator("a").allTextContents())
      .map((value) => value.replace(/\s+/g, " ").trim());
    if (labels.some((label) => label.startsWith("Team"))) throw new Error("Staff were shown the Team section");
    const body = (await floorPage.locator("body").textContent()) ?? "";
    if (/Save settings|New staff account/.test(body)) throw new Error("Staff were given controls they cannot use");

    await floorPage.goto(`${BASE}/admin/team`, { waitUntil: "domcontentloaded" });
    await floorPage.waitForURL(/\/admin\/forbidden/, { timeout: 20_000 });
    const params = new URL(floorPage.url()).searchParams;
    if (params.get("permission") !== "admin:manage") {
      throw new Error(`the forbidden page did not say which permission: ${floorPage.url()}`);
    }
    await floorPage.screenshot({ path: `${SHOTS}/13-forbidden.png` });

    await floorPage.goto(`${BASE}/admin/settings`, { waitUntil: "domcontentloaded" });
    await floorPage.getByText(/read settings but not/i).first().waitFor({ timeout: 20_000 });
    const disabled = await floorPage.locator("#set-name").isDisabled();
    if (!disabled) throw new Error("the settings form was editable by a floor account");
    await floor.close();
    return "no Team link · /admin/team → forbidden · settings read-only";
  });

  await test("Actions on a booking follow the role: the floor may release a hold, not approve one", async () => {
    // A different night from the run's own fixture: two PENDING holds cannot
    // share the same room and slot, and the console is right to refuse that.
    const held = await seatParty(cookie, { date: clubDate(16) });
    fixtures.references.push(held.reference);
    await page.goto(`${BASE}/admin/reservations?view=all&q=${held.reference}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Confirm" }).first().waitFor({ timeout: 20_000 });

    const floor = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": TEST_IP } });
    const floorPage = await floor.newPage();
    await signIn(floorPage, FLOOR_EMAIL, FLOOR_PASSWORD);
    await floorPage.goto(`${BASE}/admin/reservations?view=all&q=${held.reference}`, { waitUntil: "domcontentloaded" });
    await floorPage.locator("table tbody tr").first().waitFor({ timeout: 20_000 });
    if (await floorPage.getByRole("button", { name: "Confirm" }).count()) throw new Error("the floor were offered Confirm");
    if (!(await floorPage.getByRole("button", { name: /Release hold/ }).count())) throw new Error("the floor cannot release the hold they are standing next to");
    await floorPage.goto(`${BASE}/admin/reservations/${String((await findByReference(held.reference))._id)}`, { waitUntil: "domcontentloaded" });
    await floorPage.getByText(/see requests but not decide|Nothing recorded yet|Actions/i).first().waitFor({ timeout: 20_000 });
    await floor.close();
    return "Confirm hidden from the floor · Release hold offered";
  });

  // --------------------------------------------------------------- the phone --
  await test("On a phone the console fits, and the drawer opens and closes", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "X-Forwarded-For": TEST_IP } });
    const mobile = await phone.newPage();
    // The operator's phone is the same person, so the session cookie is carried
    // over instead of spending another slot in the login bucket.
    await mobile.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
    await phone.addCookies(await desktop.cookies(BASE));
    await mobile.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await mobile.waitForURL((url) => !url.pathname.startsWith("/admin/login"), { timeout: 25_000 });

    for (const path of SCREENS) {
      await mobile.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await mobile.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 20_000 });
      await assertNoHorizontalScroll(mobile, path);
    }
    await mobile.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await mobile.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = mobile.getByRole("navigation", { name: "Admin sections" }).last();
    await drawer.locator("a").first().waitFor({ timeout: 10_000 });
    await drawer.getByRole("link", { name: /Reservations/ }).first().click();
    await mobile.waitForURL(/\/admin\/reservations/, { timeout: 15_000 });
    await mobile.screenshot({ path: `${SHOTS}/14-board-390.png`, fullPage: true });
    await phone.close();
    return `${SCREENS.length} screens at 390px · drawer works`;
  });

  await test("Print media drops the console chrome from the booking summary", async () => {
    await page.goto(`${BASE}${bookingUrl}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 20_000 });
    await page.emulateMedia({ media: "print" });
    const navVisible = await page.getByRole("navigation", { name: "Admin sections" }).first().isVisible().catch(() => true);
    const buttons = await page.getByRole("button", { name: /Release hold|Check in|Close out|Confirm booking/ }).count();
    await page.screenshot({ path: `${SHOTS}/15-print.png`, fullPage: true });
    await page.emulateMedia({ media: "screen" });
    if (navVisible) throw new Error("the sidebar is still on the printed page");
    if (buttons > 0) throw new Error(`${buttons} action button(s) survive into the printout`);
    const doc = await findByReference(walkinRef);
    const body = (await page.locator("main").textContent()) ?? "";
    const status = (doc.status ?? "").replace("_", " ");
    if (!body.includes(walkinRef)) throw new Error("the printed summary lost the reference");
    if (!status || !body.toUpperCase().includes(status)) throw new Error(`the printed summary does not state the booking is ${status}`);
    for (const needle of [doc.customerName ?? "", "₱"]) {
      if (needle && !body.includes(needle)) throw new Error(`the printed summary lost ${needle}`);
    }
    void doc;
    return `${walkinRef} printable with its ${status} state, no controls`;
  });

  await test("A signed-out browser is bounced to the login screen, not shown a broken page", async () => {
    const cold = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": TEST_IP } });
    const coldPage = await cold.newPage();
    await coldPage.goto(`${BASE}/admin/reservations`, { waitUntil: "domcontentloaded" });
    await coldPage.waitForURL(/\/admin\/login/, { timeout: 15_000 });
    await coldPage.locator("#email, #password").first().waitFor({ timeout: 15_000 });
    const heading = (await coldPage.getByRole("heading", { level: 1 }).first().textContent()) ?? "";
    if (!/floor|console|sign/i.test(heading)) throw new Error(`the login page said “${heading}”`);
    await cold.close();
    return "/admin/reservations → /admin/login";
  });

  await test("Screenshots are on disk for a human to review", async () => {
    const files = (await readdir(SHOTS)).filter((name) => name.endsWith(".png"));
    if (files.length < 12) throw new Error(`only ${files.length} screenshots in ${SHOTS}`);
    return `${files.length} in ${SHOTS}`;
  });

  await browser.close();

  // ---------------------------------------------------------------- teardown --
  const refs = [...new Set([...fixtures.references, pendingRef, walkinRef])];
  const docs = refs.length ? await coll("reservations").find({ reservationReference: { $in: refs } }).toArray() : [];
  const ids = docs.map((doc) => doc._id);
  await coll("room_slot_locks").deleteMany({ reservation: { $in: ids } });
  await coll("payments").deleteMany({ reservation: { $in: ids } });
  await coll("reservations").deleteMany({ _id: { $in: ids } });
  const customers = await coll("customers").deleteMany({
    $or: [{ fullName: /^UI (Night|Walkin) / }, { _id: { $in: fixtures.customerIds } }],
  });
  await coll("room_blocks").deleteMany({ reason: /^UI private hire / });
  await coll("rooms").deleteMany({ _id: { $in: fixtures.roomIds } });
  await coll("admin_sessions").deleteMany({ user: { $in: fixtures.adminIds } });
  const accounts = await coll("admin_users").deleteMany({ _id: { $in: fixtures.adminIds } });
  const leftProfiles = await coll("customers").find({ fullName: /^UI (Night|Walkin) / }, { projection: { _id: 1 } }).toArray();
  const leftovers = leftProfiles.length
    ? await coll("reservations").countDocuments({ customer: { $in: leftProfiles.map((doc) => doc._id) } })
    : 0;
  console.log(
    `\n• teardown: ${ids.length} booking(s), ${customers.deletedCount} profile(s), ${fixtures.blockIds.length} block(s), ` +
      `${fixtures.roomIds.length} room(s), ${accounts.deletedCount} account(s) removed · ${leftovers} left behind`,
  );
  await mongoose.disconnect();

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
