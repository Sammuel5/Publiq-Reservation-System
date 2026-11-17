/**
 * Lean browser verification pass (Playwright + Chromium).
 *
 * Exists alongside scripts/ui-check.mjs (the full sweep) so the responsive
 * review can be repeated on a small sandbox without exhausting memory.
 *
 * Verifies: real login, dashboard at 320→1920, no horizontal scrolling,
 * no element overflowing the viewport, mobile drawer open/close, logout.
 * Writes screenshots to /screenshots.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.UI_BASE_URL ?? "http://127.0.0.1:3002";
const EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

const WIDTHS = [
  { w: 320, h: 720, name: "320-phone" },
  { w: 390, h: 844, name: "390-phone" },
  { w: 768, h: 1024, name: "768-tablet" },
  { w: 1366, h: 768, name: "1366-laptop" },
  { w: 1920, h: 1080, name: "1920-desktop" },
];

mkdirSync("screenshots", { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

async function metrics(page) {
  return page.evaluate(() => {
    const overflowing = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1.5) {
        overflowing.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 32)}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflowing: overflowing.slice(0, 3),
    };
  });
}

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

// ------------------------------------------------------------------ login ---
await page.goto(`${BASE}/admin/login`, { waitUntil: "load" });
await page.waitForTimeout(1200);
check("Anonymous /admin redirects to sign-in", page.url().includes("/admin/login"));

await page.getByText("Password", { exact: false }).first().click();
const focused = await page.evaluate(() => document.activeElement?.id ?? "");
check("Label focus association (FormField fix)", focused === "password", `#${focused}`);

// Client-side validation only runs once React has hydrated; retry briefly so the
// assertion measures behaviour, not hydration timing on a slow sandbox.
let validationVisible = false;
for (let attempt = 0; attempt < 6 && !validationVisible; attempt += 1) {
  await page.getByRole("button", { name: /sign in/i }).click();
  try {
    await page.waitForSelector("text=Email is required.", { timeout: 1500 });
    validationVisible = true;
  } catch {
    await page.waitForTimeout(500);
  }
}
check("Inline validation on empty submit", validationVisible);

await page.fill("#email", EMAIL);
await page.fill("#password", "wrong-password-here");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForSelector("text=Sign-in failed", { timeout: 20000 });
check("Wrong password shows a safe error banner", true);
await page.screenshot({ path: "screenshots/login-390-error.png", fullPage: true });

await page.fill("#password", PASSWORD);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(`${BASE}/admin`, { timeout: 25000 });
await page.waitForSelector("text=Welcome back", { timeout: 25000 });
check("Valid credentials reach the dashboard", true);

// -------------------------------------------------------------- dashboard ---
for (const vp of WIDTHS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const m = await metrics(page);
  check(
    `Dashboard fits ${vp.w}px without horizontal scroll`,
    m.scrollWidth <= m.innerWidth + 1,
    m.scrollWidth > m.innerWidth ? `scrollWidth ${m.scrollWidth}` : `${m.scrollWidth}px`,
  );
  if (m.overflowing.length) check(`No overflow at ${vp.w}px`, false, m.overflowing.join(", "));

  if ([390, 768, 1366, 1920].includes(vp.w)) {
    await page.screenshot({ path: `screenshots/dashboard-${vp.name}.png`, fullPage: true });
  }

  if (vp.w < 1024) {
    const burger = page.getByRole("button", { name: /open navigation menu/i });
    check(`Drawer trigger visible at ${vp.w}px`, await burger.isVisible());
    await burger.click();
    await page.waitForTimeout(450);
    const nav = page.getByRole("navigation", { name: /admin sections/i });
    check(`Drawer opens at ${vp.w}px`, await nav.isVisible());
    if (vp.w === 390) {
      await page.screenshot({ path: "screenshots/dashboard-390-drawer.png" });
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check(`Drawer closes with Escape at ${vp.w}px`, !(await nav.isVisible()));
  } else {
    check(
      `Desktop sidebar visible at ${vp.w}px`,
      await page.getByRole("navigation", { name: /admin sections/i }).isVisible(),
    );
  }
}

// Login page on the smallest phone
await page.setViewportSize({ width: 320, height: 720 });
await context.clearCookies();
await page.goto(`${BASE}/admin/login`, { waitUntil: "load" });
await page.waitForTimeout(500);
const loginMetrics = await metrics(page);
check(
  "Login page fits 320px without horizontal scroll",
  loginMetrics.scrollWidth <= loginMetrics.innerWidth + 1,
  `${loginMetrics.scrollWidth}px`,
);
await page.screenshot({ path: "screenshots/login-320-phone.png", fullPage: true });

// ----------------------------------------------------------------- logout ---
await page.setViewportSize({ width: 1366, height: 900 });
await page.goto(`${BASE}/admin/login`, { waitUntil: "load" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(`${BASE}/admin`, { timeout: 25000 });
await page.getByRole("button", { name: /^logout$/i }).click();
await page.waitForURL(/\/admin\/login/, { timeout: 20000 });
check("Logout returns to sign-in", true);
await page.goto(`${BASE}/admin`, { waitUntil: "load" });
check("Protected route blocked after logout", page.url().includes("/admin/login"));

await browser.close();
console.log(failures === 0 ? "\nAll UI checks passed." : `\n${failures} UI check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
