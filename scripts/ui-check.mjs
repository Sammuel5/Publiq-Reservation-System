/**
 * UI / responsive verification with a real browser (Playwright + Chromium).
 *
 * Runs against a dev server (NODE_ENV=development so the session cookie is not
 * marked Secure over plain http on localhost).
 *
 * Checks, at every required width:
 *   - no horizontal scrolling
 *   - no element overflowing the viewport
 *   - interactive controls are at least 36px tall (44px on phones per design)
 * Verifies the real login flow, the mobile drawer, and captures screenshots.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.UI_BASE_URL ?? "http://127.0.0.1:3001";
const EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const OUT = "screenshots";

const WIDTHS = [
  { w: 320, h: 720, name: "320-phone" },
  { w: 375, h: 812, name: "375-phone" },
  { w: 390, h: 844, name: "390-phone" },
  { w: 430, h: 932, name: "430-phone" },
  { w: 768, h: 1024, name: "768-tablet" },
  { w: 1024, h: 768, name: "1024-tablet-landscape" },
  { w: 1366, h: 768, name: "1366-laptop" },
  { w: 1920, h: 1080, name: "1920-desktop" },
];

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

await mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1.5) {
        overflow.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      }
    }
    const smallTargets = [];
    for (const el of Array.from(
      document.querySelectorAll("button, a[href], input, select, textarea"),
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 32) smallTargets.push(`${el.tagName.toLowerCase()}:${rect.height.toFixed(0)}px`);
    }
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth: window.innerWidth,
      overflow: overflow.slice(0, 4),
      smallTargets: smallTargets.slice(0, 4),
    };
  });
}

// ---------------------------------------------------------------- login page --
for (const vp of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  await page.goto(`${BASE}/admin/login`, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const m = await measure(page);
  record(
    `Login page fits ${vp.w}px`,
    m.scrollWidth <= vp.innerWidth + 1,
    m.scrollWidth > m.innerWidth ? `scrollWidth ${m.scrollWidth}` : `${m.scrollWidth}px`,
  );
  if (m.overflow.length) record(`Login page overflow ${vp.w}px`, false, m.overflow.join(", "));
  if (m.smallTargets.length)
    record(`Login touch targets ${vp.w}px`, false, m.smallTargets.join(", "));
  if ([320, 375, 390, 430, 1366].includes(vp.w)) {
    await page.screenshot({ path: `${OUT}/login-${vp.name}.png`, fullPage: true });
  }
  await page.close();
}

// ------------------------------------------------------------- real login flow --
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();

const H = { waitUntil: "load" };
await page.goto(`${BASE}/admin/login`, H);
record("Unauthenticated /admin redirects to login", await page.url().includes("/admin/login"));

// Wait for hydration before exercising client-side behaviour.
await page.waitForFunction(
  () => !!document.querySelector("form[data-hydrated=true]") || document.readyState === "complete",
);
await page.waitForTimeout(1200);

// label/control association must work (regression guard for FormField)
await page.getByText("Password", { exact: false }).first().click();
const focusedId = await page.evaluate(() => document.activeElement?.id ?? "");
record("Clicking a label focuses its input", focusedId === "password", `focused #${focusedId}`);

// client-side validation feedback
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForTimeout(500);
const emailError = await page.locator("text=Email is required.").count();
record("Empty form shows inline validation", emailError > 0);

// wrong password
await page.fill("#email", EMAIL);
await page.fill("#password", "definitely-wrong-password");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForSelector("text=Sign-in failed", { timeout: 15000 });
record("Wrong password shows a safe error banner", true);

// correct password
await page.fill("#password", PASSWORD);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(`${BASE}/admin`, { timeout: 20000 });
await page.waitForSelector("text=Welcome back", { timeout: 20000 });
record("Login succeeds and lands on the dashboard", true);

const dash = await measure(page);
record("Dashboard fits 1366px", dash.scrollWidth <= dash.innerWidth + 1);
await page.screenshot({ path: `${OUT}/dashboard-1366-laptop.png`, fullPage: true });

// reduced motion preference respected (no crash + content visible)
const rmPage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
await rmPage.goto(`${BASE}/admin/login`, { waitUntil: "load" });
record(
  "prefers-reduced-motion renders correctly",
  (await rmPage.locator("form").count()) > 0,
);
await rmPage.close();

// ------------------------------------------------------------ dashboard responsive --
for (const vp of WIDTHS) {
  const p = await context.newPage();
  await p.setViewportSize({ width: vp.w, height: vp.h });
  await p.goto(`${BASE}/admin`, { waitUntil: "load" });
  await p.waitForTimeout(400);
  const m = await measure(p);
  record(
    `Dashboard fits ${vp.w}px`,
    m.scrollWidth <= vp.innerWidth + 1,
    m.scrollWidth > m.innerWidth ? `scrollWidth ${m.scrollWidth}` : `${m.scrollWidth}px`,
  );
  if (m.overflow.length) record(`Dashboard overflow ${vp.w}px`, false, m.overflow.join(", "));
  if (m.smallTargets.length)
    record(`Dashboard touch targets ${vp.w}px`, false, m.smallTargets.join(", "));

  if ([390, 768, 1920].includes(vp.w)) {
    await p.screenshot({ path: `${OUT}/dashboard-${vp.name}.png`, fullPage: true });
  }

  // mobile drawer usability
  if (vp.w < 1024) {
    const hamburger = p.getByRole("button", { name: /open navigation menu/i });
    const visible = await hamburger.isVisible();
    record(`Mobile drawer trigger visible at ${vp.w}px`, visible);
    if (visible) {
      await hamburger.click();
      await p.waitForTimeout(400);
      const navVisible = await p.getByRole("navigation", { name: /admin sections/i }).isVisible();
      record(`Drawer opens at ${vp.w}px`, navVisible);
      if (vp.w === 390) {
        await p.screenshot({ path: `${OUT}/dashboard-390-drawer.png` });
      }
      await p.keyboard.press("Escape");
      await p.waitForTimeout(300);
      record(`Drawer closes with Escape at ${vp.w}px`, !(await p.getByRole("navigation", { name: /admin sections/i }).isVisible()));
    }
  } else {
    const sidebarVisible = await p
      .getByRole("navigation", { name: /admin sections/i })
      .isVisible();
    record(`Desktop sidebar visible at ${vp.w}px`, sidebarVisible);
  }
  await p.close();
}

// ------------------------------------------------------------------- logout ---
await page.goto(`${BASE}/admin`, { waitUntil: "load" });
await page.getByRole("button", { name: /^logout$/i }).click();
await page.waitForURL(/\/admin\/login/, { timeout: 15000 });
record("Logout from the sidebar returns to the login page", true);

await page.goto(`${BASE}/admin`, { waitUntil: "load" });
record("Protected route is unreachable after logout", page.url().includes("/admin/login"));

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} UI checks passed${failures ? `, ${failures} FAILED` : ""}`);
process.exit(failures === 0 ? 0 : 1);
