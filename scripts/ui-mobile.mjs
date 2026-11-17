/** Responsive checks against a live development server and test-only database.
 * Uses WebKit and Chromium phone emulation, not physical iOS/Android devices.
 * Does not create bookings. Signs in as the configured seed admin and logs out. */
import assert from "node:assert/strict";
import { chromium, webkit, devices } from "playwright";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const OWNER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const OWNER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
if (!OWNER_EMAIL || !OWNER_PASSWORD) throw new Error("Seed admin credentials are required in the test environment");
const TZ = process.env.CLUB_TIMEZONE ?? "Asia/Manila";
const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 7 * 86_400_000));
const cases = [
  { label: "iPhone SE portrait", engine: "webkit", device: "iPhone SE" },
  { label: "iPhone 8 portrait", engine: "webkit", device: "iPhone 8" },
  { label: "iPhone 13 portrait", engine: "webkit", device: "iPhone 13" },
  { label: "iPhone 15 Pro Max portrait", engine: "webkit", device: "iPhone 15 Pro Max" },
  { label: "iPhone 13 landscape", engine: "webkit", device: "iPhone 13 landscape" },
  { label: "Galaxy S9+ portrait", engine: "chromium", device: "Galaxy S9+" },
  { label: "Pixel 5 portrait", engine: "chromium", device: "Pixel 5" },
  { label: "Android small landscape", engine: "chromium", device: "Galaxy S9+", viewport: { width: 658, height: 320 } },
];
const publicPaths = ["/", "/rooms", "/rooms/sapphire-room", "/reserve", "/about", "/contact", "/lookup", "/admin/login"];
const adminPaths = ["/admin", "/admin/reservations", "/admin/calendar", "/admin/rooms", "/admin/blocks", "/admin/customers", "/admin/payments", "/admin/settings", "/admin/team", "/admin/system"];
let failures = 0;

async function audit(page, label) {
  // Let entrance animations and client navigation settle before measuring.
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const small = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea')]
      .filter((el) => el.getClientRects().length && Number.parseFloat(getComputedStyle(el).fontSize) < 16)
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}#${el.id || el.getAttribute("name") || "?"}:${getComputedStyle(el).fontSize}`);
    return { viewport: innerWidth, scroll: root.scrollWidth, small };
  });
  assert.ok(result.scroll <= result.viewport + 1, `${label}: ${result.scroll}px content in ${result.viewport}px viewport`);
  if (result.viewport <= 767) assert.equal(result.small.length, 0, `${label}: small editable fields ${result.small.join(", ")}`);
}
async function open(page, path, label) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, `${label} ${path}: HTTP ${response?.status()}`);
  await page.locator("main").first().waitFor();
  await audit(page, `${label} ${path}`);
}

for (const engine of ["webkit", "chromium"]) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
  let loginContext;
  try {
    const testIp = `2001:db8:${Math.floor(Math.random() * 65535).toString(16)}::1`;
    loginContext = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": testIp } });
    const login = await loginContext.request.post(`${BASE}/api/auth/login`, {
      headers: { Origin: BASE }, data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    assert.equal(login.status(), 200, `${engine} fixture login failed: ${login.status()}`);
    const cookies = await loginContext.cookies();
    for (const testCase of cases.filter((item) => item.engine === engine)) {
      const { defaultBrowserType: _ignored, ...device } = devices[testCase.device];
      const context = await browser.newContext({ ...device, ...(testCase.viewport ? { viewport: testCase.viewport } : {}), extraHTTPHeaders: { "X-Forwarded-For": testIp } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => {
        if (!/due to access control checks\.$/.test(error.message)) errors.push(error.message);
      });
      try {
        for (const path of publicPaths) await open(page, path, testCase.label);
        await page.goto(`${BASE}/`);
        const menu = page.getByRole("button", { name: "Open navigation menu" });
        await menu.tap();
        const nav = page.getByRole("navigation", { name: "Mobile navigation" });
        await nav.getByRole("link", { name: "My booking" }).scrollIntoViewIfNeeded();
        await nav.getByRole("link", { name: "My booking" }).tap();
        await page.waitForURL(/\/lookup/);
        await audit(page, `${testCase.label} mobile navigation`);

        // Traverse the customer wizard without submitting or writing a booking.
        await page.goto(`${BASE}/reserve`);
        await page.locator("#date").fill(date);
        await page.locator('[data-testid="slot-option"]:not([disabled])').first().waitFor({ timeout: 20_000 });
        await page.locator('[data-testid="slot-option"]:not([disabled])').first().tap();
        await page.getByRole("button", { name: /^choose a room/i }).tap();
        await page.locator('[data-testid="room-option"]:not([disabled])').first().waitFor({ timeout: 20_000 });
        await page.locator('[data-testid="room-option"]:not([disabled])').first().tap();
        await page.getByRole("button", { name: /^continue$/i }).tap();
        await page.locator("#fullName").fill("Mobile Test Guest");
        await page.locator("#mobileNumber").fill("09171234567");
        await audit(page, `${testCase.label} wizard details`);
        await page.getByRole("button", { name: /^review booking/i }).tap();
        await page.getByRole("heading", { name: /review/i }).first().waitFor();
        await audit(page, `${testCase.label} wizard review`);

        await context.addCookies(cookies);
        for (const path of adminPaths) {
          await open(page, path, testCase.label);
          assert.ok(!page.url().includes("/admin/login"), `${testCase.label} ${path}: redirected to login`);
        }
        await page.goto(`${BASE}/admin`);
        await page.getByRole("button", { name: "Open navigation menu" }).tap();
        const adminNav = page.getByRole("navigation", { name: "Admin sections" }).last();
        const lastLink = adminNav.getByRole("link", { name: /System/ });
        await lastLink.scrollIntoViewIfNeeded();
        await lastLink.tap();
        await page.waitForURL(/\/admin\/system/);
        assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
        console.log(`✓ ${testCase.label}: ${publicPaths.length} public/login + ${adminPaths.length} admin screens, menus and booking steps`);
      } catch (error) { failures++; console.error(`✗ ${testCase.label}: ${String(error.message).split("\n")[0]}`); }
      finally { await context.close(); }
    }
  } catch (error) { failures++; console.error(`✗ ${engine} setup: ${error.message}`); }
  finally {
    if (loginContext) { await loginContext.request.post(`${BASE}/api/auth/logout`, { headers: { Origin: BASE } }).catch(() => {}); await loginContext.close(); }
    await browser.close();
  }
}
console.log(`\n${cases.length - failures}/${cases.length} mobile device profiles passed (emulation, not physical devices).`);
if (failures) process.exitCode = 1;
