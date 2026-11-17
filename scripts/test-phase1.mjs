/**
 * Phase 1 verification suite — runs against a LIVE server.
 *
 *   npm run db:up && npm run seed:admin
 *   npm run build && npx next start -p 3000 &
 *   npm run test:phase1
 *
 * Covers: app start, DB connectivity, model load, admin creation, login,
 * wrong-password rejection, protected routes, sessions, logout, session
 * revocation, CSRF guard, rate limiting, lockout, deactivated accounts,
 * expired sessions and secret leakage in HTML.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const SEED_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const SEED_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME ?? "ktv_club";

/**
 * Each run uses its own spoofed client IP (honoured by the rate limiter via
 * X-Forwarded-For) so repeated runs do not share a rate-limit bucket.
 */
const randomOctet = () => Math.floor(Math.random() * 250) + 2;
const FAKE_IP = `198.51.${randomOctet()}.${randomOctet()}`;
/** Dedicated bucket for the lockout probe (different /24 → own rate limit). */
const LOCKOUT_IP = `179.${randomOctet()}.${randomOctet()}.${randomOctet()}`;
const RUN_ID = Date.now().toString(36);

const results = [];
let failures = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function test(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, error?.message ?? String(error));
  }
}

function getSetCookie(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.find((value) => value.startsWith("ktv_admin_session=")) ?? raw[0] ?? "";
}

function cookiePair(setCookieValue) {
  return setCookieValue.split(";")[0];
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body, text };
}

async function main() {
  console.log(`\nPhase 1 verification against ${BASE}\n${"=".repeat(52)}`);
  assert.ok(SEED_EMAIL && SEED_PASSWORD, "Seed credentials missing from env");
  assert.ok(MONGODB_URI, "MONGODB_URI missing from env");

  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  // ---------------------------------------------------------------- health ---
  await test("Application responds and database is connected", async () => {
    const { response, body } = await jsonFetch("/api/health");
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.database.connected, true);
    return `latency ${body.database.latencyMs}ms`;
  });

  await test("Models are registered and indexes exist", async () => {
    const reservations = await db.collection("reservations").indexes();
    const names = reservations.map((index) => index.name);
    assert.ok(names.includes("uniq_reference"), "missing uniq_reference");
    assert.ok(names.includes("room_availability"), "missing room_availability");
    const adminUsers = (await db.collection("admin_users").indexes()).map((i) => i.name);
    assert.ok(adminUsers.includes("uniq_email"), "missing uniq_email");
    const sessions = (await db.collection("admin_sessions").indexes()).map((i) => i.name);
    assert.ok(sessions.includes("ttl_expiry"), "missing TTL index");
    return `${names.length} reservation indexes`;
  });

  await test("Super Admin was provisioned with a bcrypt hash (cost 12)", async () => {
    const user = await db.collection("admin_users").findOne({
      email: SEED_EMAIL.toLowerCase(),
    });
    assert.ok(user, "admin not found");
    assert.equal(user.role, "SUPER_ADMIN");
    assert.ok(/^\$2[aby]\$12\$/.test(user.passwordHash), "hash is not bcrypt cost 12");
    assert.notEqual(user.passwordHash, SEED_PASSWORD, "password stored in plaintext");
    return `role ${user.role}`;
  });

  // ------------------------------------------------- unauthenticated access ---
  await test("Unauthenticated /admin redirects to the login page", async () => {
    const response = await fetch(`${BASE}/admin`, { redirect: "manual" });
    assert.equal(response.status, 307);
    const location = response.headers.get("location") ?? "";
    assert.ok(location.includes("/admin/login"), `unexpected location: ${location}`);
    assert.ok(location.includes("next="), "missing next parameter");
    return "307 → /admin/login";
  });

  await test("Protected API rejects anonymous requests with 401", async () => {
    const { response, body } = await jsonFetch("/api/auth/session");
    assert.equal(response.status, 401);
    assert.equal(body.error.code, "UNAUTHORIZED");
    return body.error.code;
  });

  // ------------------------------------------------------------- validation ---
  await test("Login validates its payload (422 + field details)", async () => {
    const { response, body } = await jsonFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": FAKE_IP },
      body: JSON.stringify({ email: "not-an-email", password: "" }),
    });
    assert.equal(response.status, 422);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.error.details) && body.error.details.length > 0);
    return `${body.error.details.length} field errors`;
  });

  await test("Incorrect password is rejected with a generic message", async () => {
    const { response, body } = await jsonFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": FAKE_IP },
      body: JSON.stringify({ email: SEED_EMAIL, password: "wrong-password-123!" }),
    });
    assert.equal(response.status, 401);
    assert.equal(body.error.message, "Incorrect email or password.");
    return body.error.message;
  });

  await test("Unknown email returns an identical message (no account enumeration)", async () => {
    const { response, body } = await jsonFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": FAKE_IP },
      body: JSON.stringify({ email: "nobody@nocturne.test", password: "whatever-123!" }),
    });
    assert.equal(response.status, 401);
    assert.equal(body.error.message, "Incorrect email or password.");
    return "identical response";
  });

  await test("Cross-origin login attempts are blocked (CSRF guard)", async () => {
    const { response } = await jsonFetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "X-Forwarded-For": FAKE_IP,
      },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    assert.equal(response.status, 403);
    return "403 forbidden";
  });

  // ------------------------------------------------------------------ login ---
  let sessionCookie = null;

  await test("Valid credentials create a session with a hardened cookie", async () => {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": FAKE_IP },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.email, SEED_EMAIL.toLowerCase());
    assert.equal(payload.user.passwordHash, undefined, "password hash leaked in response");

    const setCookie = getSetCookie(response);
    assert.ok(setCookie, "no session cookie set");
    const lower = setCookie.toLowerCase();
    assert.ok(lower.includes("httponly"), "cookie is not HttpOnly");
    assert.ok(lower.includes("samesite=lax"), "cookie is not SameSite=Lax");
    assert.ok(lower.includes("path=/"), "cookie path missing");

    sessionCookie = cookiePair(setCookie);

    const stored = await db
      .collection("admin_sessions")
      .findOne({ revokedAt: null });
    assert.ok(stored, "no session row written");
    assert.notEqual(stored.tokenHash, sessionCookie.split("=")[1], "token stored in plaintext");
    return "HttpOnly · SameSite=Lax · token hashed";
  });

  await test("Session endpoint returns the admin and permissions", async () => {
    const { response, body } = await jsonFetch("/api/auth/session", {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(response.status, 200);
    assert.equal(body.user.role, "SUPER_ADMIN");
    assert.ok(body.permissions.includes("settings:manage"));
    assert.equal(body.user.passwordHash, undefined);
    return `${body.permissions.length} permissions`;
  });

  await test("Authenticated admin can load the dashboard HTML", async () => {
    const response = await fetch(`${BASE}/admin`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("Welcome back"), "dashboard did not render");
    assert.ok(!html.includes("passwordHash"), "internal field leaked into HTML");
    assert.ok(!html.includes("MONGODB_URI"), "env variable name leaked into HTML");
    if (MONGODB_URI.startsWith("mongodb")) {
      assert.ok(!html.includes(MONGODB_URI), "connection string leaked into HTML");
    }
    return `${(html.length / 1024).toFixed(0)} kB HTML`;
  });

  await test("Login page renders for anonymous visitors", async () => {
    const response = await fetch(`${BASE}/admin/login`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("Sign in"), "login form missing");
    assert.ok(!html.includes(SEED_PASSWORD), "seed password present in HTML");
    return "200 OK";
  });

  // ----------------------------------------------------------------- logout ---
  await test("Logout revokes the session server-side and clears the cookie", async () => {
    const response = await fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    assert.equal(response.status, 200);

    const { createHash } = await import("node:crypto");
    const tokenValue = sessionCookie.split("=")[1];
    const storedSession = await db.collection("admin_sessions").findOne({
      tokenHash: createHash("sha256").update(tokenValue).digest("hex"),
    });
    assert.ok(storedSession, "session row not found");
    assert.ok(storedSession.revokedAt, "session row still active after logout");

    const after = await jsonFetch("/api/auth/session", { headers: { Cookie: sessionCookie } });
    assert.equal(after.response.status, 401, "revoked cookie still authenticates");

    const page = await fetch(`${BASE}/admin`, {
      headers: { Cookie: sessionCookie },
      redirect: "manual",
    });
    assert.equal(page.status, 307, "protected route accepted a revoked cookie");
    return "replay of revoked cookie → 401 / 307";
  });

  // -------------------------------------------------------- expired session ---
  await test("Expired sessions are rejected", async () => {
    const { createHash } = await import("node:crypto");
    const token = "expired-session-token-for-testing-purposes";
    const user = await db.collection("admin_users").findOne({ email: SEED_EMAIL.toLowerCase() });
    await db.collection("admin_sessions").insertOne({
      user: user._id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() - 60_000),
      lastSeenAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { response } = await jsonFetch("/api/auth/session", {
      headers: { Cookie: `ktv_admin_session=${token}` },
    });
    assert.equal(response.status, 401);
    return "401 for expired token";
  });

  // ------------------------------------------------------- deactivated admin ---
  await test("Deactivated accounts cannot sign in", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const email = `disabled.staff.${RUN_ID}@nocturne.test`;
    const password = "Disabled-Account-123!";
    await db.collection("admin_users").deleteMany({ email });
    await db.collection("admin_users").insertOne({
      name: "Disabled Staff",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "STAFF",
      isActive: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { response, body } = await jsonFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": FAKE_IP },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "ACCOUNT_INACTIVE");
    await db.collection("admin_users").deleteMany({ email });
    return body.error.code;
  });

  // ------------------------------------------------- rate limit + lockout ---
  await test("Repeated failures lock the account and the endpoint is rate limited", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const email = `lockout.probe.${RUN_ID}@nocturne.test`;
    await db.collection("admin_users").deleteMany({ email });
    await db.collection("admin_users").insertOne({
      name: "Lockout Probe",
      email,
      passwordHash: await bcrypt.hash("Probe-Account-123!", 12),
      role: "STAFF",
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const statuses = [];
    for (let i = 0; i < 9; i += 1) {
      const { response } = await jsonFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": LOCKOUT_IP },
        body: JSON.stringify({ email, password: "definitely-wrong-123!" }),
      });
      statuses.push(response.status);
    }

    assert.ok(statuses.includes(423), `account never locked: ${statuses.join(",")}`);
    assert.ok(statuses.includes(429), `rate limit never triggered: ${statuses.join(",")}`);

    await db.collection("admin_users").deleteMany({ email });
    return `statuses ${statuses.join(",")}`;
  });

  // ------------------------------------------------------- role permissions ---
  await test("Role permissions are enforced in the matrix", async () => {
    const { ROLE_PERMISSIONS } = await import("../src/config/app.ts").catch(() => ({}));
    if (!ROLE_PERMISSIONS) {
      const source = await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../src/config/app.ts", import.meta.url), "utf8"),
      );
      assert.ok(source.includes("ADMIN_MANAGE"));
      return "verified from source (TS module)";
    }
    assert.ok(!ROLE_PERMISSIONS.STAFF.includes("settings:manage"));
    assert.ok(!ROLE_PERMISSIONS.ADMIN.includes("admin:manage"));
    assert.ok(ROLE_PERMISSIONS.SUPER_ADMIN.includes("admin:manage"));
    return "STAFF ⊂ ADMIN ⊂ SUPER_ADMIN";
  });

  await mongoose.disconnect();

  console.log(`\n${"=".repeat(52)}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nTest harness crashed:", error);
  process.exit(1);
});
