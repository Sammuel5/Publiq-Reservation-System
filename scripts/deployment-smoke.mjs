/** Read-only public HTTP checks. No login, bookings, notifications or cron execution. */
const raw = process.env.STAGING_BASE_URL;
let base;
try { base = new URL(raw); } catch { console.error("Set STAGING_BASE_URL to an HTTPS origin."); process.exit(2); }
const local = process.env.SMOKE_ALLOW_LOCAL === "1" && ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
if ((base.protocol !== "https:" && !local) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
  console.error("STAGING_BASE_URL must be an HTTPS origin without credentials, path, query or fragment."); process.exit(2);
}
const headers = {};
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}: ${error.message}`); }
}
async function get(path) {
  const response = await fetch(new URL(path, base), { headers, redirect: "manual", signal: AbortSignal.timeout(12_000) });
  return response;
}
await test("Health reports a connected database", async () => {
  const r = await get("/api/health"); if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const b = await r.json(); if (b.status !== "ok" || b.database?.connected !== true) throw new Error("health is not ready");
});
await test("Public home responds successfully", async () => { const r = await get("/"); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); });
await test("Signed-out admin redirects to login", async () => {
  const r = await get("/admin/reservations");
  if (![302, 303, 307, 308].includes(r.status) || !new URL(r.headers.get("location"), base).pathname.startsWith("/admin/login")) throw new Error(`unexpected HTTP ${r.status} or redirect`);
});
for (const path of ["expire-holds", "notifications"]) await test(`Unauthenticated ${path} cron is denied`, async () => {
  const r = await get(`/api/cron/${path}`); if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
});
console.log(`\n${5 - failures}/5 read-only HTTP checks passed. This does not test bookings, delivery or cron execution.`);
if (failures) process.exitCode = 1;
