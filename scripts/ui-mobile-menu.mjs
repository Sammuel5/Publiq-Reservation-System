/** Mobile-menu regression against a running app (emulated, not physical devices). */
import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const devicesToTest = [[webkit, 'iPhone SE'], [webkit, 'iPhone 13'], [webkit, 'iPhone 13 landscape'], [chromium, 'Pixel 5'], [chromium, 'Galaxy S9+']];
let failed = 0, total = 0;
for (const [engine, name] of devicesToTest) for (const javaScriptEnabled of [true, false]) {
  total++;
  const browser = await engine.launch();
  const context = await browser.newContext({ ...devices[name], javaScriptEnabled });
  const page = await context.newPage();
  const label = `${name} (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`;
  try {
    await page.goto(base, { waitUntil: 'load' });
    const trigger = page.locator('summary[aria-label="Open navigation menu"]');
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await trigger.tap(); await nav.waitFor({ state: 'visible' });
    await trigger.tap(); await nav.waitFor({ state: 'hidden' });
    await trigger.tap(); await nav.waitFor({ state: 'visible' });
    await nav.getByRole('link', { name: 'Seating', exact: true }).tap();
    await page.waitForURL('**/spaces');
    assert.match(await page.locator('h1').innerText(), /find your place/i);
    await trigger.tap(); await nav.waitFor({ state: 'visible' });
    await nav.getByRole('link', { name: 'Seating', exact: true }).tap();
    await nav.waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log(`✓ ${label}`);
  } catch (error) { failed++; console.error(`✗ ${label}: ${error.message.split('\n')[0]}`); }
  finally { await context.close(); await browser.close(); }
}
console.log(`${total - failed}/${total} mobile menu checks passed (emulation).`);
if (failed) process.exitCode = 1;
