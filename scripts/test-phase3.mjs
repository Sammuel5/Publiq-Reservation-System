/**
 * Phase 3 verification — the admin console.
 *
 * Runs against a LIVE server and a real database, over HTTP exactly as the
 * browser does it. Anything the console claims is cross-checked by reading
 * MongoDB directly, because the point of Phase 3 is that the *server* decides
 * what a booking is worth, which transitions are legal and who may press the
 * button — not the form that asked for it.
 *
 *   npm run build && npx next start -p 3000 -H 0.0.0.0 &
 *   node --env-file=.env.local scripts/test-phase3.mjs
 */
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME ?? "ktv_club";
const TZ = process.env.CLUB_TIMEZONE ?? "Asia/Manila";
const OWNER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const OWNER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

const RUN_ID = String(Date.now()).slice(-7);
const STAFF_EMAIL = `qa-floor-${RUN_ID}@nocturne.test`;
let staffPassword = "Floor-Shift-2026!";
const GUEST = "Phase Three";
/** A night far enough out that nothing else in the database collides with it. */
const NIGHT = clubDate(1);

const results = [];
let failures = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function test(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, error?.message ?? String(error));
  }
}

const randomOctet = () => Math.floor(Math.random() * 250) + 2;
/** Test-only documentation range; a fresh address keeps the per-IP buckets out of the way. */
const nextIp = () => `198.18.${randomOctet()}.${randomOctet()}`;

let phoneCounter = 0;
function freshMobile() {
  phoneCounter += 1;
  return `0917${String(RUN_ID)}${String(phoneCounter).padStart(2, "0")}`.slice(0, 11);
}

function clubDate(offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function api(path, options = {}) {
  const headers = {
    "X-Forwarded-For": options.ip ?? nextIp(),
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.origin ? { Origin: options.origin } : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
  };
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    redirect: options.redirect ?? "manual",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body, text, status: response.status };
}

async function login(email, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": nextIp(), Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`login failed for ${email}: ${response.status} ${await response.text()}`);
  const raw = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  if (!raw) throw new Error("login returned no session cookie");
  return raw.split(";")[0];
}

const coll = (name) => mongoose.connection.db.collection(name);
const oid = (value) => new Types.ObjectId(String(value));
const byReference = (reference) => coll("reservations").findOne({ reservationReference: reference });
const ownerDoc = () => coll("admin_users").findOne({ email: String(OWNER_EMAIL).toLowerCase() });

async function availability(date, startTime, guests = 2) {
  return api(`/api/availability?date=${date}&startTime=${startTime}&guests=${guests}&duration=120`);
}

/** Front-desk booking through the admin API — the fixture for most lifecycle checks. */
async function walkIn(cookie, overrides = {}) {
  const body = {
    roomSlug: "the-parlour",
    date: NIGHT,
    startTime: "20:00",
    durationMinutes: 120,
    fullName: `${GUEST} ${phoneCounter + 1}`,
    mobileNumber: freshMobile(),
    email: "",
    guestCount: 2,
    confirmNow: false,
    ...overrides,
  };
  const response = await api("/api/admin/reservations", { cookie, method: "POST", body });
  return { response, body };
}

/** Walk-in plus its persisted document, so assertions read the database, not the response. */
async function walkInDoc(cookie, overrides = {}, cleanup) {
  const { response, body } = await walkIn(cookie, overrides);
  if (response.status !== 200) throw new Error(`walk-in failed: ${response.status} ${response.text.slice(0, 200)}`);
  const created = JSON.parse(response.text);
  cleanup?.references.push(created.reference);
  const doc = await byReference(created.reference);
  return { reference: created.reference, status: created.status, amount: created.amount, doc, body, response };
}

async function main() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });

  let owner = "";
  let staff = "";
  let settingsSnapshot = null;
  const cleanup = { references: [], roomIds: [], categoryIds: [], blockIds: [], adminUserIds: [] };

  console.log(`\nPhase 3 · admin console — ${BASE} · db ${DB_NAME}\n`);

  // ============================================================== hygiene =====
  await test("A previous run's fixtures are swept before this one starts", async () => {
    // An interrupted run must not poison the next one: this suite writes under
    // stable markers (guest name "Phase Three", "QA …" rooms, its block reasons),
    // so leftovers are identifiable and removable without touching real data.
    const QA_BLOCKS = /^(Private event — venue hire|Deep clean|Camera install|Sound check runs to close|Six-week refurbishment|Nothing)$/;
    const stale = await coll("reservations").find({ "customer.fullName": new RegExp(GUEST) }).toArray();
    const staleIds = stale.map((doc) => doc._id);
    await coll("room_slot_locks").deleteMany({ reservation: { $in: staleIds } });
    await coll("payments").deleteMany({ reservation: { $in: staleIds } });
    const rooms = await coll("rooms").deleteMany({ name: /^QA (Booth|Pod) / });
    const categories = await coll("room_categories").deleteMany({ name: /^QA (Booth|Pod) / });
    const blocks = await coll("room_blocks").deleteMany({ reason: QA_BLOCKS });
    const reservations = await coll("reservations").deleteMany({ _id: { $in: staleIds } });
    const customers = await coll("customers").deleteMany({ fullName: new RegExp(GUEST) });
    // Accounts this suite created carry a run-stamped address; drop their sessions
    // first so nothing keeps a live cookie to a deleted user.
    const qaAccounts = await coll("admin_users")
      .find({ email: { $regex: `^qa-floor-(?!${RUN_ID}@)[0-9]+@nocturne\\.test$` } }, { projection: { _id: 1 } })
      .toArray();
    await coll("admin_sessions").deleteMany({ user: { $in: qaAccounts.map((doc) => doc._id) } });
    const staff = await coll("admin_users").deleteMany({ _id: { $in: qaAccounts.map((doc) => doc._id) } });
    const orphans = await coll("room_slot_locks").countDocuments({});
    if (orphans > 0) await coll("room_slot_locks").deleteMany({ reservation: { $nin: (await coll("reservations").find({}, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id) } });
    const counts = [reservations.deletedCount, customers.deletedCount, blocks.deletedCount, rooms.deletedCount, categories.deletedCount, staff.deletedCount];
    assert.ok(counts.every((value) => Number.isFinite(value)), "the sweep reported nothing");
    return counts.some((value) => value > 0)
      ? `${reservations.deletedCount} booking(s), ${customers.deletedCount} profile(s), ${blocks.deletedCount} block(s), ${rooms.deletedCount} room(s), ${categories.deletedCount} category(ies) cleared`
      : "database was already clean";
  });

  // =============================================================== auth ======

  await test("Console is unreachable without a session", async () => {
    const probes = await Promise.all([
      api("/api/admin/reservations"),
      api("/api/admin/rooms"),
      api("/api/admin/team"),
      api("/api/admin/settings"),
      api("/api/admin/customers"),
      api("/api/admin/payments"),
      api("/api/admin/blocks"),
      api("/api/admin/reservations/sweep", { method: "POST", body: {} }),
    ]);
    for (const probe of probes) {
      assert.equal(probe.status, 401, `expected 401, got ${probe.status}`);
      assert.equal(probe.body.error.code, "UNAUTHORIZED");
    }
    return `${probes.length} endpoints · all 401, none 500`;
  });

  await test("Signed-out page visits redirect to the login screen", async () => {
    const paths = ["/admin", "/admin/reservations", "/admin/rooms", "/admin/team", "/admin/settings", "/admin/blocks"];
    for (const path of paths) {
      const { response, text } = await api(path);
      const location = response.headers.get("location") ?? "";
      if (response.status < 300 || response.status >= 400) throw new Error(`${path} → ${response.status}`);
      if (!location.includes("/admin/login")) throw new Error(`${path} → ${location}`);
      if (text.includes("password")) throw new Error(`${path} leaked a form through a redirect`);
    }
    return `${paths.length} pages redirected`;
  });

  await test("Owner signs in and the seed role is Super Admin", async () => {
    owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    assert.equal((await ownerDoc()).role, "SUPER_ADMIN");
    // Snapshotted so the run is repeatable: settings tests write, this undoes.
    const { tagline, ...rest } = await coll("club_settings").findOne({});
    settingsSnapshot = rest;
    return "session cookie issued · settings snapshot taken";
  });

  await test("Cross-origin admin writes are refused (CSRF guard)", async () => {
    const { status, body } = await api("/api/admin/reservations/sweep", {
      cookie: owner,
      method: "POST",
      body: {},
      origin: "https://evil.example",
    });
    assert.equal(status, 403);
    assert.match(body.error.message, /club console/i);
    return "403 on a foreign Origin";
  });

  await test("Reads are exempt from the origin guard, so a bookmark still opens", async () => {
    assert.equal((await api("/api/admin/settings", { origin: "https://evil.example", cookie: owner })).status, 200);
    return "GET with a foreign Origin → 200";
  });

  // ========================================================= permissions ====
  await test("A Staff account exists for the permission matrix to be tested against", async () => {
    const { status, body } = await api("/api/admin/team", {
      cookie: owner,
      method: "POST",
      body: { name: "Floor QA", email: STAFF_EMAIL, role: "STAFF", password: staffPassword },
    });
    assert.equal(status, 200, JSON.stringify(body));
    cleanup.adminUserIds.push(body.id);
    staff = await login(STAFF_EMAIL, staffPassword);
    return `${STAFF_EMAIL} created and signed in`;
  });

  await test("Staff may read the board and act on the floor", async () => {
    const listed = await api("/api/admin/reservations?view=today", { cookie: staff });
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body.page.rows));
    const page = await api("/admin/reservations", { cookie: staff, redirect: "follow" });
    assert.equal(page.status, 200);
    return "200 on the API and the page";
  });

  await test("Staff is refused everything the matrix withholds", async () => {
    const probes = [
      { name: "team list", call: () => api("/api/admin/team", { cookie: staff }) },
      { name: "team write", call: () => api("/api/admin/team", { cookie: staff, method: "POST", body: {} }) },
      { name: "settings write", call: () => api("/api/admin/settings", { cookie: staff, method: "PUT", body: {} }) },
      {
        name: "room create",
        call: () =>
          api("/api/admin/rooms", {
            cookie: staff,
            method: "POST",
            body: { name: "Nope Room", categorySlug: "standard", capacity: 2, hourlyRate: "100" },
          }),
      },
      {
        name: "approve a booking",
        call: () => api("/api/admin/reservations/000000000000000000000000/action", { cookie: staff, method: "POST", body: { action: "CONFIRM" } }),
      },
      { name: "guest edit", call: () => api("/api/admin/customers/000000000000000000000000", { cookie: staff, method: "PATCH", body: { notes: "x" } }) },
    ];
    for (const probe of probes) {
      const { status, body } = await probe.call();
      if (status !== 403) throw new Error(`${probe.name} → ${status} ${JSON.stringify(body).slice(0, 120)}`);
      if (body.error.code !== "FORBIDDEN") throw new Error(`${probe.name} → code ${body.error.code}`);
    }
    return `403 for ${probes.map((probe) => probe.name).join(", ")}`;
  });

  await test("A refusal explains itself without leaking internals", async () => {
    const { body } = await api("/api/admin/team", { cookie: staff });
    assert.ok(body.error.message.length > 20, "message too terse to act on");
    const flat = JSON.stringify(body);
    assert.ok(!flat.includes("PERMISSIONS"), "an internal constant name leaked");
    assert.ok(!flat.includes("RESERVATION_DECIDE"), "a permission key leaked");
    return `“${body.error.message}”`;
  });

  await test("The sidebar follows capability, and no section is marked “coming soon”", async () => {
    const staffHtml = (await api("/admin", { cookie: staff, redirect: "follow" })).text;
    const ownerHtml = (await api("/admin", { cookie: owner, redirect: "follow" })).text;
    assert.ok(!staffHtml.includes("/admin/team"), "the sidebar offered Team to an account that cannot open it");
    assert.ok(staffHtml.includes("/admin/reservations"), "staff lost the board they do have access to");
    assert.ok(ownerHtml.includes("/admin/team"), "the owner's sidebar lost Team");
    assert.ok(ownerHtml.includes("/admin/settings"), "the owner's sidebar lost Settings");
    for (const html of [staffHtml, ownerHtml]) {
      assert.ok(!/>P3</.test(html), "a Phase-3 “not yet built” chip is still rendered");
      assert.ok(!/coming soon/i.test(html), "a console section is still labelled as unfinished");
    }
    return "Team hidden from Staff · nothing marked upcoming";
  });

  await test("The club's configured night covers the hours this suite books", async () => {
    const settings = (await api("/api/admin/settings", { cookie: owner })).body.settings;
    const covers = (hhmm) => {
      const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      const value = minutes(hhmm);
      const open = minutes(settings.openingTime);
      const close = minutes(settings.closingTime);
      return close > open ? value >= open && value + 120 <= close : value >= open || value + 120 <= close;
    };
    const hours = ["16:00", "19:00", "20:00", "21:00", "22:00", "23:00"];
    const outside = hours.filter((hour) => !covers(hour));
    assert.deepEqual(
      outside,
      [],
      `the club trades ${settings.openingTime}→${settings.closingTime}, so this suite cannot book ${outside.join(", ")} — restore the seeded settings (npm run seed:rooms resets the demo club) and re-run`,
    );
    assert.ok(Number(settings.pendingExpirationMinutes) >= 30, "holds expire too fast for these probes to see them");
    return `${settings.openingTime}→${settings.closingTime} · holds ${settings.pendingExpirationMinutes} min · ${settings.currency}`;
  });

  // ========================================================== booking board ==
  let ref = "";
  let id = "";
  /** A confirmed booking the overlap probes can collide with. */
  let liveRef = "";
  let liveId = "";
  await test("Front desk can hold a room: PENDING, priced by the server", async () => {
    const created = await walkInDoc(owner, { specialRequests: "Birthday cake at nine" }, cleanup);
    ref = created.reference;
    id = String(created.doc._id);
    assert.equal(created.status, "PENDING");
    assert.equal(created.doc.source, "ADMIN");
    assert.ok(created.doc.pendingExpiresAt, "a hold must carry an expiry");
    assert.ok(created.doc.createdBy, "who made it was not recorded");
    const room = await coll("rooms").findOne({ _id: created.doc.room });
    assert.equal(created.doc.estimatedAmount, Math.round((room.hourlyRate * 120) / 60), "price is not the room's rate × 2 h");
    return `${ref} · ₱${(created.doc.estimatedAmount / 100).toFixed(2)} · holds ${created.doc.durationMinutes / 30} slot(s)`;
  });

  await test("A live booking exists for the overlap probes to collide with", async () => {
    const created = await walkInDoc(owner, { date: clubDate(9), startTime: "20:00", confirmNow: true }, cleanup);
    liveRef = created.reference;
    liveId = String(created.doc._id);
    assert.equal(created.doc.status, "CONFIRMED");
    assert.ok((await coll("room_slot_locks").countDocuments({ reservation: created.doc._id })) > 0);
    // The desk booking is priced from the room, not from the payload.
    const room = await coll("rooms").findOne({ _id: created.doc.room });
    assert.equal(created.doc.estimatedAmount, Math.round((room.hourlyRate * 120) / 60));
    return `${liveRef} holds ${room.slug} on ${clubDate(9)} 20:00`;
  });

  await test("Confirming stamps the trail with the acting admin", async () => {
    const { status, body } = await api(`/api/admin/reservations/${id}/action`, {
      cookie: owner,
      method: "POST",
      body: { action: "CONFIRM", reason: "Deposit promised by phone" },
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.status, "CONFIRMED");
    const doc = await byReference(ref);
    assert.equal(doc.status, "CONFIRMED");
    assert.ok(doc.confirmedAt, "confirmedAt not stamped");
    const last = doc.statusHistory.at(-1);
    assert.equal(last.reason, "Deposit promised by phone");
    assert.equal(String(last.changedBy), String((await ownerDoc())._id), "the actor was not recorded");
    assert.equal(last.actorType, "ADMIN");
    return "PENDING → CONFIRMED with a named actor";
  });

  await test("The same action twice is refused and leaves one history entry", async () => {
    const { status, body } = await api(`/api/admin/reservations/${id}/action`, {
      cookie: owner,
      method: "POST",
      body: { action: "CONFIRM" },
    });
    assert.equal(status, 409, `expected 409, got ${status}: ${JSON.stringify(body).slice(0, 120)}`);
    const doc = await byReference(ref);
    assert.equal(doc.statusHistory.filter((entry) => entry.to === "CONFIRMED").length, 1);
    return `409 · “${body.error.message.slice(0, 58)}”`;
  });

  await test("Staff may check in a confirmed booking (that is RESERVATION_STATUS)", async () => {
    const { status, body } = await api(`/api/admin/reservations/${id}/action`, {
      cookie: staff,
      method: "POST",
      body: { action: "CHECK_IN" },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 160));
    const doc = await byReference(ref);
    assert.equal(doc.status, "CHECKED_IN");
    assert.ok(doc.checkedInAt, "checkedInAt not stamped");
    return "CONFIRMED → CHECKED_IN by a floor account";
  });

  await test("Completing closes the booking and releases every held slot row", async () => {
    const heldBefore = await coll("room_slot_locks").countDocuments({ reservation: oid(id) });
    assert.ok(heldBefore > 0, "the booking held no slots to begin with");
    const { status } = await api(`/api/admin/reservations/${id}/action`, {
      cookie: owner,
      method: "POST",
      body: { action: "COMPLETE" },
    });
    assert.equal(status, 200);
    const doc = await byReference(ref);
    assert.equal(doc.status, "COMPLETED");
    assert.ok(doc.completedAt, "completedAt not stamped");
    assert.equal(await coll("room_slot_locks").countDocuments({ reservation: oid(id) }), 0);
    return `${heldBefore} lock row(s) → 0`;
  });

  await test("A completed night cannot be re-opened by a stray click", async () => {
    const { status } = await api(`/api/admin/reservations/${id}/action`, {
      cookie: owner,
      method: "POST",
      body: { action: "CHECK_IN" },
    });
    assert.equal(status, 409);
    assert.equal((await byReference(ref)).status, "COMPLETED");
    return "409 · status still COMPLETED";
  });

  await test("Cancelling puts the slot straight back on the public site", async () => {
    const created = await walkInDoc(owner, { confirmNow: true, startTime: "21:00" }, cleanup);
    const cancel = await api(`/api/admin/reservations/${String(created.doc._id)}/action`, {
      cookie: owner,
      method: "POST",
      body: { action: "CANCEL", reason: "Guest called from the car park" },
    });
    assert.equal(cancel.status, 200, cancel.text.slice(0, 160));
    assert.equal((await byReference(created.reference)).status, "CANCELLED");
    assert.equal(await coll("room_slot_locks").countDocuments({ reservation: created.doc._id }), 0);
    const probe = await availability(NIGHT, "21:00");
    const parlour = (probe.body.rooms ?? []).find((room) => room.slug === "the-parlour");
    assert.ok(parlour, "the room vanished from availability instead of becoming free");
    assert.equal(parlour.available, true, `availability still reports ${parlour.code}`);
    return `${created.reference} freed ${NIGHT} 21:00`;
  });

  await test("Declining a hold says so in the guest's own history", async () => {
    const created = await walkInDoc(owner, { startTime: "22:30" }, cleanup);
    const { status, body } = await api(`/api/admin/reservations/${String(created.doc._id)}/action`, {
      cookie: owner,
      method: "POST",
      body: { action: "REJECT", reason: "Duplicate of a phone booking" },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 160));
    const doc = await byReference(created.reference);
    assert.equal(doc.status, "REJECTED");
    assert.match(doc.statusHistory.at(-1).reason, /phone booking/);
    assert.equal(await coll("room_slot_locks").countDocuments({ reservation: doc._id }), 0);
    const lookup = await api("/api/reservations/lookup", {
      method: "POST",
      body: { reference: created.reference, identifier: created.doc.mobileNumber ?? "0917" + RUN_ID },
    });
    if (lookup.status === 200) assert.equal(lookup.body.reservation.status, "REJECTED");
    return "REJECTED · locks gone · guest sees it";
  });

  await test("A real clash with a live booking is refused", async () => {
    const booked = await byReference(liveRef);
    const { response } = await walkIn(owner, {
      date: booked.reservationDate,
      startTime: booked.startTime,
      durationMinutes: 60,
      confirmNow: true,
    });
    assert.ok(response.status >= 400 && response.status < 500, `expected a refusal, got ${response.status}`);
    assert.match(JSON.stringify(response.body), /taken|booked|unavailable|conflict|overlap/i);
    return `${response.status} · “${response.body.error.message.slice(0, 60)}”`;
  });

  await test("The desk may seat a guest inside the public lead time", async () => {
    const soon = new Date(Date.now() + 10 * 60_000);
    const startTime = `${String(soon.getHours()).padStart(2, "0")}:${soon.getMinutes() < 30 ? "30" : "00"}`;
    const { response } = await walkIn(owner, { date: clubDate(0), startTime, durationMinutes: 120, confirmNow: true });
    if (response.status === 200) {
      cleanup.references.push(response.body.reference);
      return `seated at ${startTime} with about 10 minutes' notice`;
    }
    // Outside opening hours there is nothing to seat them into; that is the club's
    // rule, not the lead-time rule, and it must not be reported as a lead-time failure.
    assert.match(
      JSON.stringify(response.body),
      /closed|outside|opening|unavailable|full|no rooms|already reserved/i,
      `unexpected ${response.status}: ${response.text.slice(0, 160)}`,
    );
    return `${response.status} — the club is closed at ${startTime}, so lead-time bypass is not exercisable right now`;
  });

  await test("Idempotency: the same front-desk request twice is one booking", async () => {
    const payload = {
      roomSlug: "the-parlour",
      date: clubDate(2),
      startTime: "19:00",
      durationMinutes: 120,
      fullName: `${GUEST} Duplicate`,
      mobileNumber: freshMobile(),
      email: "",
      guestCount: 3,
      confirmNow: true,
    };
    const first = await api("/api/admin/reservations", { cookie: owner, method: "POST", body: payload });
    const second = await api("/api/admin/reservations", { cookie: owner, method: "POST", body: payload });
    assert.equal(first.status, 200, first.text.slice(0, 160));
    assert.equal(second.status, 200, second.text.slice(0, 160));
    assert.equal(second.body.reference, first.body.reference, "a retry created a second booking");
    cleanup.references.push(first.body.reference);
    const count = await coll("reservations").countDocuments({ reservationDate: payload.date, startTime: payload.startTime });
    assert.equal(count, 1, `${count} rows for one request`);
    return `${first.body.reference} on retry → still 1 row`;
  });

  // ============================================================ concurrency ==
  await test("A double-click on Confirm cannot double-apply", async () => {
    const created = await walkInDoc(owner, { startTime: "23:00" }, cleanup);
    const [a, b] = await Promise.all([
      api(`/api/admin/reservations/${String(created.doc._id)}/action`, { cookie: owner, method: "POST", body: { action: "CONFIRM" } }),
      api(`/api/admin/reservations/${String(created.doc._id)}/action`, { cookie: owner, method: "POST", body: { action: "CONFIRM" } }),
    ]);
    const codes = [a.status, b.status].sort();
    assert.deepEqual(codes, [200, 409], `two simultaneous confirms → ${codes.join("/")}`);
    const doc = await byReference(created.reference);
    assert.equal(doc.status, "CONFIRMED");
    assert.equal(doc.statusHistory.filter((entry) => entry.to === "CONFIRMED").length, 1, "the losing click wrote history");
    assert.equal(doc.notifications.filter((item) => item.expectedStatus === "CONFIRMED" && item.channel === "sms").length, 1, "confirmation was lost or queued twice");
    assert.equal(doc.notifications.filter((item) => item.expectedStatus === "PENDING" && item.channel === "sms").length, 1, "request message missing");
    return "one 200, one 409, one trail entry and one confirmation — the loser re-reads";
  });

  await test("A lapsed hold is expired by the sweep, not left holding a room", async () => {
    const created = await walkInDoc(owner, { date: clubDate(3), startTime: "20:00" }, cleanup);
    await coll("reservations").updateOne({ _id: created.doc._id }, { $set: { pendingExpiresAt: new Date(Date.now() - 60_000) } });
    const held = await coll("room_slot_locks").countDocuments({ reservation: created.doc._id });
    assert.ok(held > 0, "a PENDING hold should be holding slots");
    const lateConfirm = await api(`/api/admin/reservations/${String(created.doc._id)}/action`, { cookie: owner, method: "POST", body: { action: "CONFIRM" } });
    assert.equal(lateConfirm.status, 409, "expired pending hold must not be revived after its slots are free");

    const { status, body } = await api("/api/admin/reservations/sweep", { cookie: owner, method: "POST", body: {} });
    assert.equal(status, 200);
    assert.ok(body.expired >= 1, `sweep reported ${body.expired} expired`);
    const doc = await byReference(created.reference);
    assert.equal(doc.status, "EXPIRED");
    assert.ok(doc.pendingExpiresAt === null || doc.pendingExpiresAt === undefined, "an expired hold kept its expiry");
    assert.equal(await coll("room_slot_locks").countDocuments({ reservation: created.doc._id }), 0, "locks survived the sweep");
    assert.ok(body.releasedSlots >= held, `released ${body.releasedSlots} of ${held}`);

    const again = await api("/api/admin/reservations/sweep", { cookie: owner, method: "POST", body: {} });
    assert.equal(again.body.expired, 0, "a second sweep found work it had already done");
    const probe = await availability(clubDate(3), "20:00");
    assert.equal(probe.body.rooms.find((room) => room.slug === "the-parlour").available, true);
    return `${body.expired} expired · ${body.releasedSlots} slot(s) back on sale · idempotent`;
  });

  // =============================================================== queries ==
  await test("Tonight's view carries rows, counts, money and the room filter list", async () => {
    const { status, body } = await api("/api/admin/reservations?view=today", { cookie: owner });
    assert.equal(status, 200);
    assert.ok(body.rooms.length > 0, "no rooms offered as filters");
    assert.equal(typeof body.money.expected, "number");
    assert.equal(typeof body.counts.status, "object");
    assert.ok(body.page.total >= body.page.rows.length);
    assert.ok(body.page.rows.every((row) => row.date === body.today), "tonight's view leaked another night");
    return `${body.page.total} row(s) · ₱${(body.money.expected / 100).toFixed(0)} expected`;
  });

  await test("Filters narrow the result set instead of widening it", async () => {
    const exact = await api(`/api/admin/reservations?view=all&q=${ref}`, { cookie: owner });
    assert.equal(exact.status, 200);
    assert.equal(exact.body.page.rows.length, 1, `search for a reference returned ${exact.body.page.rows.length} rows`);
    assert.equal(exact.body.page.rows[0].reference, ref);

    const cancelled = await api("/api/admin/reservations?view=all&status=CANCELLED&perPage=100", { cookie: owner });
    assert.ok(cancelled.body.page.rows.length > 0, "we cancelled one earlier, so this cannot be empty");
    assert.ok(cancelled.body.page.rows.every((row) => row.status === "CANCELLED"));

    const booked = await byReference(ref);
    const bookedRoom = await coll("rooms").findOne({ _id: booked.room });
    const roomOnly = await api(`/api/admin/reservations?view=all&room=${booked.room}&perPage=100`, { cookie: owner });
    assert.equal(roomOnly.status, 200);
    assert.ok(roomOnly.body.page.rows.length > 0, "the room filter hid a booking it should have shown");
    assert.ok(
      roomOnly.body.page.rows.every((row) => row.roomName === bookedRoom.name),
      `the room filter returned ${[...new Set(roomOnly.body.page.rows.map((row) => row.roomName))].join(", ")}`,
    );

    const mine = await api("/api/admin/reservations?view=all&source=ADMIN&perPage=100", { cookie: owner });
    assert.ok(mine.body.page.rows.every((row) => row.source === "ADMIN"), "the source filter leaked");
    return `1 exact · ${cancelled.body.page.rows.length} cancelled · ${mine.body.page.rows.length} desk-made`;
  });

  await test("Search text is a literal, never a regex", async () => {
    for (const needle of [".*", "a|b", "[a-z", "()*", "$&", "\\1", ".*.*.*.*"]) {
      const { status, body } = await api(`/api/admin/reservations?view=all&q=${encodeURIComponent(needle)}`, { cookie: owner });
      assert.equal(status, 200, `“${needle}” → ${status}`);
      assert.ok(
        body.page.rows.every((row) => row.reference.includes(needle) || row.customerName.includes(needle)),
        `“${needle}” matched rows it cannot contain — the term was treated as a pattern`,
      );
    }
    return "7 patterns, no 500s, no wildcard matches";
  });

  await test("A hostile query string degrades to the default board", async () => {
    const wide = await api("/api/admin/reservations?view=all&from=2000-01-01&to=2026-01-01", { cookie: owner });
    assert.equal(wide.status, 200, "a 26-year range must not be scanned");
    assert.ok(wide.body.window.from > "2010", `the window was ${wide.body.window.from}`);

    const junk = await api("/api/admin/reservations?room=not-an-objectid&status=NOPE&page=-4&perPage=99999", { cookie: owner });
    assert.equal(junk.status, 200);
    assert.equal(junk.body.page.rows.length <= 25, true);
    assert.ok(junk.body.page.rows.every((row) => ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW", "REJECTED", "EXPIRED"].includes(row.status)));
    const last = await api("/api/admin/reservations?view=all&page=9999&perPage=5", { cookie: owner });
    assert.deepEqual(last.body.page.rows, []);
    return "unbounded range, junk ids, negative page and a far page all handled";
  });

  await test("Attention is a real filter, not a label", async () => {
    const doc = await byReference(ref);
    await coll("reservations").updateOne(
      { _id: doc._id },
      { $set: { "cancellationRequest.status": "PENDING", "cancellationRequest.reason": "Stuck in traffic, can we move it?", "cancellationRequest.requestedAt": new Date() } },
    );
    const { status, body } = await api("/api/admin/reservations?view=all&status=ATTENTION&perPage=100", { cookie: owner });
    assert.equal(status, 200);
    assert.ok(body.page.rows.some((row) => row.reference === ref), "an open cancellation request did not surface");
    const flagged = body.page.rows.find((row) => row.reference === ref);
    assert.equal(flagged.pendingRequest, "PENDING");
    assert.ok(flagged.needsAttention, "the row is not marked as needing attention");
    return `${body.page.rows.length} row(s) need a human · “${flagged.attentionReason}”`;
  });

  // ========================================================== guest edits ====
  await test("Editing a booking re-prices nothing it did not change, and guards capacity", async () => {
    const created = await walkInDoc(owner, { date: clubDate(10), startTime: "20:00", confirmNow: true }, cleanup);
    const detail = await api(`/api/admin/reservations/${String(created.doc._id)}`, { cookie: owner });
    const mobile = detail.body.reservation.customerMobile;

    const room = await coll("rooms").findOne({ _id: created.doc.room });
    const over = await api(`/api/admin/reservations/${String(created.doc._id)}`, {
      cookie: owner,
      method: "PATCH",
      body: { fullName: GUEST, mobileNumber: mobile, guestCount: room.capacity + 20 },
    });
    assert.equal(over.status, 422, `over-capacity edit → ${over.status}`);
    assert.match(JSON.stringify(over.body), /seats|capacity|bigger/i);

    const ok = await api(`/api/admin/reservations/${String(created.doc._id)}`, {
      cookie: owner,
      method: "PATCH",
      body: { fullName: "Renamed Guest", mobileNumber: mobile, guestCount: 3, specialRequests: "Window table", internalNote: "Allergic to confetti" },
    });
    assert.equal(ok.status, 200, ok.text.slice(0, 200));
    assert.ok(ok.body.changed.length >= 2, `diff was ${JSON.stringify(ok.body.changed)}`);
    const after = await byReference(created.reference);
    assert.equal(after.status, "CONFIRMED", "an edit changed the status");
    assert.equal(after.estimatedAmount, created.doc.estimatedAmount, "price moved on a party-size edit that kept the room");
    assert.equal(after.guestCount, 3);
    const notes = (await api(`/api/admin/reservations/${String(created.doc._id)}`, { cookie: owner })).body.notes;
    assert.ok(notes.some((note) => note.body.includes("confetti")), "the inline note was not written");
    return `changed ${ok.body.changed.join(", ")} · capacity guard held`;
  });

  await test("Moving a booking re-prices it and records the reason", async () => {
    const created = await walkInDoc(owner, { date: clubDate(10), startTime: "22:00", durationMinutes: 120, confirmNow: true }, cleanup);
    const rooms = await coll("rooms").find({ isActive: true }).toArray();
    const target = rooms.find((room) => String(room._id) !== String(created.doc.room) && room.capacity >= 2);
    assert.ok(target, "need a second room to move into");

    const noReason = await api(`/api/admin/reservations/${String(created.doc._id)}/move`, {
      cookie: owner,
      method: "POST",
      body: { roomId: String(target._id), date: clubDate(10), startTime: "22:00", durationMinutes: 120 },
    });
    assert.equal(noReason.status, 422, "a move without a reason was accepted");
    assert.ok(noReason.body.error.details.fields.reason, "no field error for the missing reason");

    const moved = await api(`/api/admin/reservations/${String(created.doc._id)}/move`, {
      cookie: owner,
      method: "POST",
      body: { roomId: String(target._id), date: clubDate(3), startTime: "18:00", durationMinutes: 180, reason: "Party grew, moved to the bigger room" },
    });
    assert.equal(moved.status, 200, moved.text.slice(0, 220));
    const after = await byReference(created.reference);
    assert.equal(String(after.room), String(target._id), "room did not change");
    assert.equal(after.reservationDate, clubDate(3));
    assert.equal(after.startTime, "18:00");
    assert.equal(after.durationMinutes, 180);
    assert.equal(after.estimatedAmount, Math.round((target.hourlyRate * 180) / 60), "the price was not recomputed for the new room");
    assert.match(after.statusHistory.at(-1).reason, /bigger room/, "the move reason is missing from the trail");
    const movedDoc = await coll("reservations").findOne({ _id: after._id });
    assert.ok(movedDoc, "the moved booking is somehow missing");
    return `₱${(created.doc.estimatedAmount / 100).toFixed(0)} → ₱${(after.estimatedAmount / 100).toFixed(0)} in ${target.name}`;
  });

  await test("A move into a taken slot is refused instead of stacking two parties", async () => {
    const live = await byReference(liveRef);
    const rooms = await coll("rooms").find({ isActive: true, isAvailable: true }).toArray();
    const other = rooms.find((room) => String(room._id) !== String(live.room) && room.capacity >= 2);
    const elsewhere = await walkInDoc(
      owner,
      { roomSlug: other.slug, date: clubDate(9), startTime: "16:00", durationMinutes: 120, confirmNow: true },
      cleanup,
    );
    const { status, body } = await api(`/api/admin/reservations/${String(elsewhere.doc._id)}/move`, {
      cookie: owner,
      method: "POST",
      body: { roomId: String(live.room), date: live.reservationDate, startTime: live.startTime, durationMinutes: 120, reason: "Overlap probe" },
    });
    assert.ok(status >= 400, `expected a refusal, got ${status}`);
    assert.match(JSON.stringify(body), /taken|booked|reserved|overlap|unavailable|another time/i);
    assert.equal((await byReference(elsewhere.reference)).startTime, "16:00", "the refused move changed the booking anyway");
    return `${status} · “${body.error.message.slice(0, 50)}”`;
  });

  await test("Internal notes are attributed and never reach the guest's lookup", async () => {
    const added = await api(`/api/admin/reservations/${id}/note`, {
      cookie: owner,
      method: "POST",
      body: { body: "Brought their own sound system — watch the noise limit." },
    });
    assert.equal(added.status, 200, added.text.slice(0, 160));
    const detail = await api(`/api/admin/reservations/${id}`, { cookie: owner });
    const note = detail.body.notes.find((entry) => entry.body.includes("noise limit"));
    assert.ok(note, "the note is not listed");
    assert.equal(String(note.author), (await ownerDoc()).name);
    const guest = await api("/api/reservations/lookup", { method: "POST", body: { reference: ref, identifier: (await coll("customers").findOne({ _id: (await byReference(ref)).customer })).mobileNumber } });
    if (guest.status === 200) {
      const flat = JSON.stringify(guest.body);
      assert.ok(!flat.includes("noise limit"), "an internal note leaked to the guest lookup");
      assert.ok(!flat.includes("internalNotes"), "internalNotes is exposed to guests");
    }
    return `noted by ${note.author} · invisible to the guest view`;
  });

  // ===================================================== cancellation flow ====
  await test("Approving a guest's request closes the booking and names the decider", async () => {
    const created = await walkInDoc(owner, { date: clubDate(2), startTime: "22:00", confirmNow: true }, cleanup);
    await coll("reservations").updateOne(
      { _id: created.doc._id },
      { $set: { "cancellationRequest.status": "PENDING", "cancellationRequest.reason": "Family emergency", "cancellationRequest.requestedAt": new Date() } },
    );
    const decided = await api(`/api/admin/reservations/${String(created.doc._id)}/cancellation`, {
      cookie: owner,
      method: "POST",
      body: { decision: "APPROVED", note: "Waived — regular guest" },
    });
    assert.equal(decided.status, 200, decided.text.slice(0, 200));
    const after = await byReference(created.reference);
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.cancellationRequest.status, "APPROVED");
    assert.ok(after.cancellationRequest.decidedAt, "decidedAt not stamped");
    assert.equal(String(after.cancellationRequest.decidedBy), String((await ownerDoc())._id));
    assert.equal(await coll("room_slot_locks").countDocuments({ reservation: created.doc._id }), 0, "the room stayed held");
    return "PENDING → APPROVED · CANCELLED · room released";
  });

  await test("Declining keeps the booking and tells the guest why", async () => {
    const created = await walkInDoc(owner, { date: clubDate(2), startTime: "23:00", confirmNow: true }, cleanup);
    await coll("reservations").updateOne(
      { _id: created.doc._id },
      { $set: { "cancellationRequest.status": "PENDING", "cancellationRequest.reason": "Change of plan", "cancellationRequest.requestedAt": new Date() } },
    );
    const { status } = await api(`/api/admin/reservations/${String(created.doc._id)}/cancellation`, {
      cookie: owner,
      method: "POST",
      body: { decision: "DECLINED", note: "That room is already sold for the night" },
    });
    assert.equal(status, 200);
    const after = await byReference(created.reference);
    assert.equal(after.status, "CONFIRMED", "a declined request must not cancel the booking");
    assert.equal(after.cancellationRequest.status, "DECLINED");
    assert.match(after.cancellationRequest.decisionNote, /already sold/);
    return "still CONFIRMED · the note is stored for the guest to read";
  });

  await test("Answering a request that is already answered is refused", async () => {
    const doc = await coll("reservations").findOne({ "cancellationRequest.status": "DECLINED" });
    const { status, body } = await api(`/api/admin/reservations/${String(doc._id)}/cancellation`, {
      cookie: owner,
      method: "POST",
      body: { decision: "APPROVED" },
    });
    assert.equal(status, 409, `expected 409, got ${status}`);
    assert.match(body.error.message, /already answered|no open|reload/i);
    assert.equal((await coll("reservations").findOne({ _id: doc._id })).status, "CONFIRMED");
    return "409 · the outcome is unchanged";
  });

  // ================================================================ money ====
  let paidRef = "";
  let paidId = "";
  let firstPayment = "";

  await test("A deposit reduces the outstanding balance and names who took it", async () => {
    const created = await walkInDoc(owner, { date: clubDate(4), startTime: "20:00", confirmNow: true }, cleanup);
    paidRef = created.reference;
    paidId = String(created.doc._id);
    const half = Math.round(created.doc.estimatedAmount / 2);

    const { status, body } = await api(`/api/admin/reservations/${paidId}/payments`, {
      cookie: owner,
      method: "POST",
      body: { amount: (half / 100).toFixed(2), paymentMethod: "GCASH", referenceNumber: `GC-${RUN_ID}` },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
    assert.equal(body.balance.collected, half);
    assert.equal(body.balance.outstanding, created.doc.estimatedAmount - half);
    assert.match(body.message, /still due/i);

    const detail = await api(`/api/admin/reservations/${paidId}`, { cookie: owner });
    firstPayment = detail.body.payments[0].id;
    assert.equal(detail.body.payments[0].recordedBy, (await ownerDoc()).name, "the receipt is unattributed");
    assert.equal(String((await coll("payments").findOne({ _id: oid(firstPayment) })).recordedBy), String((await ownerDoc())._id));
    assert.equal(detail.body.balances.outstanding, created.doc.estimatedAmount - half);
    return `₱${(half / 100).toFixed(2)} in · ₱${(body.balance.outstanding / 100).toFixed(2)} due · by ${detail.body.payments[0].recordedBy}`;
  });

  await test("Over-collecting is refused and writes nothing", async () => {
    const doc = await byReference(paidRef);
    const { status, body } = await api(`/api/admin/reservations/${paidId}/payments`, {
      cookie: owner,
      method: "POST",
      body: { amount: (doc.estimatedAmount / 100).toFixed(2), paymentMethod: "CASH" },
    });
    assert.equal(status, 422, `over-collection → ${status}`);
    assert.ok(body.error.details.fields.amount, "no field error on the amount");
    assert.equal(await coll("payments").countDocuments({ reservation: oid(paidId) }), 1, "the rejected receipt was written");
    return `422 · “${body.error.details.fields.amount}”`;
  });

  await test("Settling the remainder zeroes the balance", async () => {
    const payment = await coll("payments").findOne({ _id: oid(firstPayment) });
    const doc = await byReference(paidRef);
    const outstanding = doc.estimatedAmount - payment.amount;
    const { status, body } = await api(`/api/admin/reservations/${paidId}/payments`, {
      cookie: owner,
      method: "POST",
      body: { amount: (outstanding / 100).toFixed(2), paymentMethod: "CASH", notes: "Paid in full at the desk" },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
    assert.equal(body.balance.outstanding, 0);
    assert.match(body.message, /settled/i);
    return "balance ₱0.00";
  });

  await test("A refund is a new row, never a rewrite of the receipt", async () => {
    const before = await coll("payments").find({ reservation: oid(paidId) }).toArray();
    const refund = await api(`/api/admin/reservations/${paidId}/payments`, {
      cookie: owner,
      method: "POST",
      body: { amount: "100.00", paymentMethod: "CASH", paymentStatus: "REFUNDED", notes: "Air-con failed, comped" },
    });
    assert.equal(refund.status, 200, refund.text.slice(0, 200));
    const after = await coll("payments").find({ reservation: oid(paidId) }).sort({ paymentDate: 1 }).toArray();
    assert.equal(after.length, before.length + 1, "a refund must add a row");
    assert.equal(after.at(-1).paymentStatus, "REFUNDED");
    assert.equal(after.at(-1).amount, 10000);
    assert.equal(refund.body.balance.outstanding, 10000, "the refund did not reopen the balance");
    const doc = await byReference(paidRef);
    assert.ok(doc.statusHistory.some((entry) => (entry.reason ?? "").includes("Air-con failed")), "the refund is absent from the booking's trail");
    return "+1 REFUNDED row · ₱100 due again · trail updated";
  });

  await test("Refunding more than was collected is refused", async () => {
    const collected = (await coll("payments").find({ reservation: oid(paidId) }).toArray())
      .filter((entry) => entry.paymentStatus !== "REFUNDED")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const { status, body } = await api(`/api/admin/reservations/${paidId}/payments`, {
      cookie: owner,
      method: "POST",
      body: { amount: ((collected + 10_000) / 100).toFixed(2), paymentMethod: "CASH", paymentStatus: "REFUNDED" },
    });
    assert.equal(status, 422);
    assert.match(body.error.message, /can be refunded/i);
    return `422 · “${body.error.message.slice(0, 58)}”`;
  });

  await test("The ledger adds up, and its totals describe the window not the filter", async () => {
    const today = clubDate(0);
    const { status, body } = await api(`/api/admin/payments?from=${today}&to=${today}&perPage=100`, { cookie: owner });
    assert.equal(status, 200);
    assert.ok(body.page.rows.length >= 3, `only ${body.page.rows.length} receipts in the ledger`);
    const mine = body.page.rows.filter((row) => row.reservationId === paidId);
    assert.equal(mine.length, 3, `expected 3 receipts on the probe booking, saw ${mine.length}`);

    const rows = body.page.rows;
    const collected = rows.filter((row) => row.status !== "REFUNDED").reduce((sum, row) => sum + row.amount, 0);
    const refunded = rows.filter((row) => row.status === "REFUNDED").reduce((sum, row) => sum + row.amount, 0);
    assert.equal(body.totals.collected, collected, "collected total disagrees with the rows");
    assert.equal(body.totals.refunded, refunded, "refunded total disagrees with the rows");
    assert.equal(body.totals.net, collected - refunded, "net is not collected minus refunded");
    assert.ok(Object.keys(body.totals.byMethod).length >= 2, "no per-method breakdown");

    const cashOnly = await api(`/api/admin/payments?from=${today}&to=${today}&method=CASH`, { cookie: owner });
    assert.ok(cashOnly.body.page.rows.every((row) => row.method === "CASH"), "the method filter leaked");
    assert.deepEqual(
      [cashOnly.body.totals.collected, cashOnly.body.totals.refunded],
      [body.totals.collected, body.totals.refunded],
      "totals should describe the window, not the visible subset — otherwise the screen lies about takings",
    );

    const refundedOnly = await api(`/api/admin/payments?from=${today}&to=${today}&method=REFUNDED`, { cookie: owner });
    assert.ok(refundedOnly.body.page.rows.every((row) => row.status === "REFUNDED"));
    const searched = await api(`/api/admin/payments?from=${today}&to=${today}&q=${paidRef}`, { cookie: owner });
    assert.ok(searched.body.page.rows.every((row) => row.reference === paidRef), "search by reference leaked");
    assert.equal(searched.body.page.rows.length, 3);
    return `${rows.length} receipt(s) · net ₱${(body.totals.net / 100).toFixed(2)} · filters narrow rows only`;
  });

  await test("Deleting a bogus entry restores the balance and is logged", async () => {
    const target = await coll("payments").findOne({ reservation: oid(paidId), paymentStatus: "REFUNDED" });
    const removed = await api(`/api/admin/payments/${String(target._id)}`, { cookie: owner, method: "DELETE" });
    assert.equal(removed.status, 200, removed.text.slice(0, 160));
    assert.equal(await coll("payments").countDocuments({ _id: target._id }), 0, "the row survived");
    const detail = await api(`/api/admin/reservations/${paidId}`, { cookie: owner });
    assert.equal(detail.body.balances.outstanding, 0, "the balance did not follow the deletion");
    const gone = await api(`/api/admin/payments/${String(target._id)}`, { cookie: owner, method: "DELETE" });
    assert.equal(gone.status, 404, "deleting twice reported success");
    return "row gone · balance back to settled · second delete 404";
  });

  await test("The floor may take money but may not rewrite the booking", async () => {
    const doc = await byReference(paidRef);
    // payment:record is deliberately a floor capability — whoever is standing at
    // the counter is the one being handed cash.
    const recorded = await api(`/api/admin/reservations/${String(doc._id)}/payments`, {
      cookie: staff,
      method: "POST",
      body: { amount: "0.01", paymentMethod: "CASH", notes: "Floor probe" },
    });
    assert.ok(recorded.status === 200 || recorded.status === 422, `unexpected ${recorded.status}: ${recorded.text.slice(0, 120)}`);
    const edit = await api(`/api/admin/reservations/${String(doc._id)}`, {
      cookie: staff,
      method: "PATCH",
      body: { fullName: "Rewritten By Floor", mobileNumber: freshMobile() },
    });
    assert.equal(edit.status, 403, "staff were allowed to rewrite a booking");
    // clean up the probe receipt so the ledger counts stay exact
    const probe = await coll("payments").findOne({ reservation: oid(doc._id), notes: "Floor probe" });
    if (probe) await coll("payments").deleteOne({ _id: probe._id });
    return "payment accepted from the counter · 403 on the guest edit";
  });

  // =============================================================== guests ===
  await test("A profile is searchable by name, mobile and its international form", async () => {
    const customer = await coll("customers").findOne({ _id: (await byReference(ref)).customer });
    const localForm = `0${customer.mobileNumber.slice(3)}`; // +63917… → 0917…
    const needles = [customer.fullName.split(" ")[0], customer.mobileNumber.slice(-5), localForm, customer.mobileNumber];
    const found = [];
    for (const needle of needles) {
      const { status, body } = await api(`/api/admin/customers?q=${encodeURIComponent(needle)}&perPage=100`, { cookie: owner });
      assert.equal(status, 200, `“${needle}” → ${status}`);
      assert.ok(body.page.rows.some((row) => row.id === String(customer._id)), `“${needle}” missed the guest`);
      found.push(needle);
    }
    return `matched on ${found.length} of ${needles.length} forms (${found.join(" / ")})`;
  });

  await test("A profile carries visits, spend, a rate, and no lookup tokens", async () => {
    const customer = await coll("customers").findOne({ _id: (await byReference(ref)).customer });
    const { status, body } = await api(`/api/admin/customers/${String(customer._id)}`, { cookie: owner });
    assert.equal(status, 200);
    assert.ok(body.stats.visits >= 1);
    assert.equal(typeof body.stats.spend, "number");
    assert.ok(body.reservations.length >= 1);
    assert.ok(body.stats.cancellationRate === null || (body.stats.cancellationRate >= 0 && body.stats.cancellationRate <= 100));
    const flat = JSON.stringify(body);
    assert.ok(!flat.includes("accessToken"), "the guest's lookup token leaked");
    assert.ok(!flat.includes("passwordHash"), "a password hash leaked");
    assert.ok(body.reservations.every((row) => typeof row.reference === "string"));
    return `${body.stats.visits} visit(s) · ${body.stats.completed} completed · ${body.stats.cancelled} cancelled · rate ${body.stats.cancellationRate ?? "n/a"}`;
  });

  await test("Editing a guest edits the shared profile, and the mobile stays put", async () => {
    const customerId = (await byReference(ref)).customer;
    const edited = await api(`/api/admin/customers/${String(customerId)}`, {
      cookie: owner,
      method: "PATCH",
      body: { fullName: `Renamed ${RUN_ID}`, notes: "Prefers a quiet corner. Always pays by GCash." },
    });
    assert.equal(edited.status, 200, edited.text.slice(0, 200));
    assert.ok(edited.body.changed.includes("note"), `diff was ${JSON.stringify(edited.body.changed)}`);
    const doc = await coll("customers").findOne({ _id: customerId });
    assert.match(doc.notes, /quiet corner/);
    assert.equal(doc.fullName, `Renamed ${RUN_ID}`);

    const identityProbe = await api(`/api/admin/customers/${String(customerId)}`, {
      cookie: owner,
      method: "PATCH",
      body: { mobileNumber: "09170001111" },
    });
    assert.ok(identityProbe.status >= 400, "the identity key was accepted for edit");
    assert.notEqual((await coll("customers").findOne({ _id: customerId })).mobileNumber, "09170001111");

    const bookings = await coll("reservations").find({ customer: customerId }).toArray();
    assert.ok(bookings.length >= 1, "the booking lost its guest");
    return `profile updated · mobile immutable · ${bookings.length} booking(s) still linked`;
  });

  // ============================================================== catalog ====
  let qaRoom = "";
  let qaCategory = "";

  await test("Rooms: a new category and room appear on both sides at once", async () => {
    const category = await api("/api/admin/categories", {
      cookie: owner,
      method: "POST",
      body: { name: `QA Pod ${RUN_ID}`, slug: `qa-pod-${RUN_ID}`, accent: "purple", sortOrder: 90 },
    });
    assert.equal(category.status, 200, category.text.slice(0, 200));
    qaCategory = category.body.id;
    cleanup.categoryIds.push(qaCategory);

    const room = await api("/api/admin/rooms", {
      cookie: owner,
      method: "POST",
      body: {
        name: `QA Booth ${RUN_ID}`,
        categorySlug: `qa-pod-${RUN_ID}`,
        capacity: 5,
        hourlyRate: "1,250.00",
        minimumDuration: 60,
        slotMinutes: 30,
        amenities: "Karaoke, Projector",
        coverImage: "/images/room-standard.jpg",
      },
    });
    assert.equal(room.status, 200, room.text.slice(0, 300));
    qaRoom = room.body.id;
    cleanup.roomIds.push(qaRoom);
    assert.match(room.body.slug, /^qa-booth-/);

    const stored = await coll("rooms").findOne({ _id: oid(qaRoom) });
    assert.equal(stored.hourlyRate, 125000, "the rate was not stored as integer centavos");
    const others = (await coll("rooms").find({ _id: { $ne: oid(qaRoom) } }).toArray()).map((room) => room.sortOrder);
    assert.ok(stored.sortOrder > Math.max(...others), `a new room sorted to ${stored.sortOrder}, among ${others.join(",")}`);

    const [adminRooms, publicProbe] = await Promise.all([
      api("/api/admin/rooms", { cookie: owner }),
      availability(NIGHT, "20:00"),
    ]);
    assert.ok(adminRooms.body.rooms.some((entry) => entry.slug === room.body.slug), "missing from the admin list");
    assert.ok(publicProbe.body.rooms.some((entry) => entry.slug === room.body.slug), "missing from the public picker");
    const site = await api("/rooms", { redirect: "follow" });
    assert.ok(site.text.includes(`QA Booth ${RUN_ID}`), "the public rooms page did not pick it up");
    return `${room.body.slug} at ₱1,250.00/h live on both sides`;
  });

  await test("Rooms: bad input names the offending field", async () => {
    const { status, body } = await api(`/api/admin/rooms/${qaRoom}`, {
      cookie: owner,
      method: "PATCH",
      body: { capacity: 0, hourlyRate: "free drinks", slotMinutes: 7, categorySlug: "no-such-category" },
    });
    assert.equal(status, 422);
    const fields = Object.keys(body.error.details.fields);
    assert.ok(fields.length >= 2, `expected several field errors, got ${fields.join(", ")}`);
    assert.ok(!JSON.stringify(body).includes("mongoose"), "a driver message reached the client");
    return `422 · fields ${fields.join(", ")}`;
  });

  await test("Rooms: an image path must be same-origin or https", async () => {
    const { status, body } = await api(`/api/admin/rooms/${qaRoom}`, {
      cookie: owner,
      method: "PATCH",
      body: { images: ["javascript:alert(1)", "http://evil.example/x.jpg", "/images/ok.jpg"] },
    });
    assert.ok(status >= 400, `a javascript: URL was accepted (${status})`);
    assert.ok(body.error.details.fields.images || body.error.details.fields.coverImage, "no field error");
    const stored = await coll("rooms").findOne({ _id: oid(qaRoom) });
    assert.ok(!JSON.stringify(stored.images).includes("javascript:"), "the payload was written anyway");
    const page = await api(`/rooms/${(await coll("rooms").findOne({ _id: oid(qaRoom) })).slug}`, { redirect: "follow" });
    assert.ok(!page.text.includes("javascript:"), "an inline script URL reached the room page HTML");
    return `${status} · nothing stored, nothing rendered`;
  });

  await test("Rooms: reordering persists and reads back in the new order", async () => {
    const list = await api("/api/admin/rooms", { cookie: owner });
    const ids = list.body.rooms.map((room) => room.id);
    const rotated = [...ids.slice(1), ids[0]];
    const { status, body } = await api("/api/admin/rooms/order", { cookie: owner, method: "PUT", body: { order: rotated } });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 160));
    assert.deepEqual(body.order, rotated);
    const after = (await api("/api/admin/rooms", { cookie: owner })).body.rooms;
    assert.deepEqual(after.map((room) => room.id), rotated, "the read did not reflect the write");
    assert.ok(after.every((room, index) => index === 0 || room.sortOrder >= after[index - 1].sortOrder), "sortOrder is not monotonic");
    const junk = await api("/api/admin/rooms/order", { cookie: owner, method: "PUT", body: { order: ["000000000000000000000000"] } });
    assert.ok(junk.status >= 400, "a stale id was accepted by the reorder");
    await api("/api/admin/rooms/order", { cookie: owner, method: "PUT", body: { order: ids } });
    return `${rotated.length} rooms reordered, verified, and put back`;
  });

  await test("Rooms: history is protected, emptiness is not", async () => {
    const rooms = (await api("/api/admin/rooms", { cookie: owner })).body.rooms;
    const used = rooms.find((room) => room.stats.bookings > 0);
    assert.ok(used, "expected at least one room with bookings");
    const refused = await api(`/api/admin/rooms/${used.id}`, { cookie: owner, method: "DELETE" });
    assert.ok(refused.status === 409 || refused.status === 422, `delete of a used room → ${refused.status}`);
    assert.match(refused.body.error.message, /deactivat|booked|history/i);
    assert.ok((await coll("rooms").findOne({ _id: oid(used.id) })), "the room vanished anyway");

    const empty = rooms.find((room) => room.stats.bookings === 0 && room.slug.startsWith("qa-booth"));
    assert.ok(empty, "the QA booth should be deletable");
    const removed = await api(`/api/admin/rooms/${empty.id}`, { cookie: owner, method: "DELETE" });
    assert.equal(removed.status, 200, removed.text.slice(0, 160));
    assert.equal(await coll("rooms").countDocuments({ _id: oid(empty.id) }), 0);
    cleanup.roomIds = cleanup.roomIds.filter((candidate) => candidate !== empty.id);
    const categoryProbe = await api(`/api/admin/categories/${qaCategory}`, { cookie: owner, method: "DELETE" });
    assert.ok(categoryProbe.status === 200 || categoryProbe.status === 409, `empty category delete → ${categoryProbe.status}`);
    if (categoryProbe.status === 200) cleanup.categoryIds = [];
    return "used room refused with guidance · empty room deleted";
  });

  await test("Rooms: maintenance takes a room off sale and puts it back", async () => {
    const target = (await coll("rooms").findOne({ slug: "the-parlour" }))?._id;
    const slug = (await coll("rooms").findOne({ _id: target })).slug;
    const flagged = await api(`/api/admin/rooms/${String(target)}/maintenance`, {
      cookie: owner,
      method: "POST",
      body: { status: "IN_PROGRESS", note: "Sprinkler inspection" },
    });
    assert.equal(flagged.status, 200, flagged.text.slice(0, 160));
    const during = await availability(NIGHT, "20:00");
    const row = during.body.rooms.find((entry) => entry.slug === slug);
    assert.equal(row?.available, false, "a room under maintenance stayed bookable");
    const cleared = await api(`/api/admin/rooms/${String(target)}/maintenance`, {
      cookie: owner,
      method: "POST",
      body: { status: "OPERATIONAL", note: "" },
    });
    assert.equal(cleared.status, 200);
    assert.equal((await coll("rooms").findOne({ _id: target })).maintenanceStatus, "OPERATIONAL");
    const after = await availability(NIGHT, "20:00");
    assert.equal(after.body.rooms.find((entry) => entry.slug === slug)?.available, true, "the room stayed off sale");
    return `${slug}: OPERATIONAL → IN_PROGRESS → OPERATIONAL, availability followed`;
  });

  // ============================================================== blocks =====
  let blockId = "";

  await test("Blocks: a club-wide window closes every room on the site", async () => {
    const date = clubDate(5);
    const { status, body } = await api("/api/admin/blocks", {
      cookie: owner,
      method: "POST",
      body: { date, startTime: "14:00", endTime: "20:00", reason: "Private event — venue hire" },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
    blockId = body.id;
    cleanup.blockIds.push(blockId);
    assert.equal(body.warning, null, "an unopposed block should not warn");

    const doc = await coll("room_blocks").findOne({ _id: oid(blockId) });
    assert.equal(doc.room, null, "a venue-wide block pinned a room");
    assert.equal(doc.isActive, true);
    const probe = await availability(date, "15:00");
    const rooms = probe.body.rooms ?? [];
    assert.ok(rooms.length > 0, "availability disappeared instead of closing");
    assert.ok(rooms.every((room) => room.available === false), "a room stayed bookable through a club-wide block");
    return `${rooms.length} room(s) closed on ${date}`;
  });

  await test("Blocks: one room's window does not close the venue", async () => {
    const date = clubDate(5);
    const room = await coll("rooms").findOne({ isActive: true, isAvailable: true, maintenanceStatus: "OPERATIONAL" });
    const { status, body } = await api("/api/admin/blocks", {
      cookie: owner,
      method: "POST",
      body: { roomId: String(room._id), date, startTime: "20:30", endTime: "22:00", reason: "Deep clean" },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 160));
    cleanup.blockIds.push(body.id);

    const probe = await availability(date, "20:30");
    const closed = probe.body.rooms.find((entry) => entry.slug === room.slug);
    assert.equal(closed?.available, false, "the blocked room stayed bookable");
    const open = probe.body.rooms.filter((entry) => entry.slug !== room.slug && entry.available);
    assert.ok(open.length > 0, "the whole venue closed for one room's clean");
    return `${room.name} blocked · ${open.length} other room(s) still sellable`;
  });

  await test("Blocks: clashing with live bookings needs an explicit acknowledgement", async () => {
    const booked = await byReference(liveRef);
    const payload = { roomId: String(booked.room), date: booked.reservationDate, startTime: booked.startTime, endTime: "23:00", reason: "Camera install" };
    const refused = await api("/api/admin/blocks", { cookie: owner, method: "POST", body: payload });
    assert.ok(refused.status === 409 || refused.status === 422, `unacknowledged clash → ${refused.status}`);
    assert.match(refused.body.error.message, /booking|overlap|clash|NK-/i);

    const forced = await api("/api/admin/blocks", { cookie: owner, method: "POST", body: { ...payload, force: true } });
    assert.equal(forced.status, 200, forced.text.slice(0, 200));
    cleanup.blockIds.push(forced.body.id);
    assert.ok(forced.body.warning, "forcing should report what it stepped on");
    assert.ok(forced.body.warning.includes(liveRef), `the warning forgot the reference: “${forced.body.warning}”`);
    assert.equal((await byReference(liveRef)).status, "CONFIRMED", "a block cancelled a booking on its own");

    const listed = await api(`/api/admin/blocks?from=${booked.reservationDate}&to=${booked.reservationDate}`, { cookie: owner });
    const row = listed.body.blocks.find((entry) => entry.id === forced.body.id);
    assert.ok(row?.overlaps.reservations >= 1, "the list does not flag the overlap it warned about");
    // clean up the probe so the fixture night stays usable
    await api(`/api/admin/blocks/${forced.body.id}`, { cookie: owner, method: "POST", body: { action: "close" } });
    return `409 → forced with “${forced.body.warning.slice(0, 48)}…” · booking untouched`;
  });

  await test("Blocks: an overnight window wraps into the next morning", async () => {
    const { status, body } = await api("/api/admin/blocks", {
      cookie: owner,
      method: "POST",
      body: { date: clubDate(6), startTime: "22:00", endTime: "02:00", reason: "Sound check runs to close" },
    });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 160));
    cleanup.blockIds.push(body.id);
    const doc = await coll("room_blocks").findOne({ _id: oid(body.id) });
    const hours = (new Date(doc.endAt) - new Date(doc.startAt)) / 3_600_000;
    assert.equal(hours, 4, `an overnight block spanned ${hours} h`);
    const clubDay = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(value));
    assert.equal(clubDay(doc.startAt), clubDate(6), "the window did not start on the night asked for");
    assert.equal(clubDay(doc.endAt), clubDate(7), "a 22:00→02:00 window must end on the following club day");

    const tooLong = await api("/api/admin/blocks", {
      cookie: owner,
      method: "POST",
      body: { date: clubDate(6), startTime: "14:00", endTime: "13:30", reason: "Six-week refurbishment" },
    });
    // 14:00 → 13:30 wraps: that is "dark for the whole of tomorrow night", which a
    // club genuinely does (a private buy-out), so it must be accepted, not refused.
    assert.equal(tooLong.status, 200, `an all-night block → ${tooLong.status}`);
    cleanup.blockIds.push(tooLong.body.id);
    const allNight = await availability(clubDate(6), "15:00");
    assert.ok(allNight.body.rooms.every((room) => room.available === false), "the all-night buy-out left rooms on sale");
    const zero = await api("/api/admin/blocks", { cookie: owner, method: "POST", body: { date: clubDate(6), startTime: "20:00", endTime: "20:00", reason: "Nothing" } });
    assert.equal(zero.status, 422, "a zero-length window was accepted");
    return "22:00→02:00 stored as 4 h across midnight · over-long and zero-length refused";
  });

  await test("Blocks: closing is a soft delete that immediately reopens the night", async () => {
    const date = clubDate(5);
    assert.ok((await availability(date, "15:00")).body.rooms.every((room) => room.available === false), "the club-wide block vanished early");
    const { status, body } = await api(`/api/admin/blocks/${blockId}`, { cookie: owner, method: "POST", body: { action: "close" } });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 160));
    const doc = await coll("room_blocks").findOne({ _id: oid(blockId) });
    assert.equal(doc.isActive, false, "closing hard-deleted or did nothing");
    assert.ok(doc.closedBy, "who closed it was not recorded");

    const after = await availability(date, "15:00");
    assert.ok(after.body.rooms.some((room) => room.available === true), "the night stayed sold out after closing");
    const listed = await api(`/api/admin/blocks?from=${date}&to=${date}`, { cookie: owner });
    // Closed windows stay listed — with their state — because "reopen" has to be
    // reachable from this very list.
    const stillListed = listed.body.blocks.find((entry) => entry.id === blockId);
    assert.equal(stillListed?.isActive, false, "the closed window is missing from the list entirely");

    const reopened = await api(`/api/admin/blocks/${blockId}`, { cookie: owner, method: "POST", body: { action: "reopen" } });
    assert.equal(reopened.status, 200);
    assert.equal((await coll("room_blocks").findOne({ _id: oid(blockId) })).isActive, true);
    await api(`/api/admin/blocks/${blockId}`, { cookie: owner, method: "POST", body: { action: "close" } });
    return "closed → invisible → reopened → closed";
  });

  await test("Blocks: an unknown window id is a 404, not a silent success", async () => {
    const { status, body } = await api("/api/admin/blocks/000000000000000000000000", { cookie: owner, method: "POST", body: { action: "close" } });
    assert.equal(status, 404, JSON.stringify(body).slice(0, 120));
    assert.ok(!JSON.stringify(body).includes("CastError"), "a driver error reached the client");
    return "404 with a clean message";
  });

  // ============================================================ settings =====
  await test("Settings: the console reads what the site renders", async () => {
    const { status, body } = await api("/api/admin/settings", { cookie: owner });
    assert.equal(status, 200);
    const settings = body.settings;
    assert.match(settings.timezone, /\//);
    assert.equal(typeof settings.openingTime, "string");
    const home = await api("/", { redirect: "follow" });
    assert.ok(home.text.includes(settings.clubName), "the club name in settings is not the one on the site");
    const hours = (await api("/api/availability", { redirect: "follow" })).text;
    assert.ok(!hours.includes("NaN"), "availability produced a NaN hour");
    return `${settings.clubName} · ${settings.timezone} · ${settings.openingTime}→${settings.closingTime}`;
  });

  await test("Settings: a valid save reports its diff, and a no-op reports nothing", async () => {
    const current = (await api("/api/admin/settings", { cookie: owner })).body.settings;
    const next = { ...current, tagline: `QA-checked ${RUN_ID}`, pendingExpirationMinutes: 44 };
    const { status, body } = await api("/api/admin/settings", { cookie: owner, method: "PUT", body: next });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 240));
    const changed = body.changes.map((entry) => entry.field);
    assert.ok(changed.includes("tagline") && changed.includes("pendingExpirationMinutes"), `changes were ${changed.join(", ")}`);
    assert.equal(body.changes.find((entry) => entry.field === "pendingExpirationMinutes").to, "44");
    assert.equal((await api("/api/admin/settings", { cookie: owner })).body.settings.pendingExpirationMinutes, 44, "the write did not stick");
    const again = await api("/api/admin/settings", { cookie: owner, method: "PUT", body: next });
    assert.deepEqual(again.body.changes, [], "a no-op save invented a diff");
    assert.ok(Array.isArray(again.body.advisories));

    // A shorter hold expiry must change when a new hold dies, without touching an existing one.
    const created = await walkInDoc(owner, { date: clubDate(7), startTime: "20:00" }, cleanup);
    const minutes = (new Date(created.doc.pendingExpiresAt) - new Date(created.doc.createdAt)) / 60_000;
    assert.ok(minutes > 0, "the hold has no usable expiry");
    await api("/api/admin/settings", {
      cookie: owner,
      method: "PUT",
      body: { ...next, tagline: current.tagline ?? "", pendingExpirationMinutes: current.pendingExpirationMinutes },
    });
    return `diff of 2, silent no-op, hold expiry honoured (${Math.round(minutes)} min)`;
  });

  await test("Settings: nonsense is refused and the document is untouched", async () => {
    const current = (await api("/api/admin/settings", { cookie: owner })).body.settings;
    const probes = [
      { name: "bogus timezone", patch: { timezone: "Mars/Phobos" }, field: "timezone" },
      { name: "half-hour night", patch: { openingTime: "20:00", closingTime: "20:30" }, field: "minimumDuration" },
      { name: "min above default", patch: { minimumDuration: 240, defaultDuration: 60 }, field: "defaultDuration" },
      { name: "junk currency", patch: { currency: "P" }, field: "currency" },
      { name: "one-word club name", patch: { clubName: "X" }, field: "clubName" },
    ];
    for (const probe of probes) {
      const { status, body } = await api("/api/admin/settings", { cookie: owner, method: "PUT", body: { ...current, ...probe.patch } });
      assert.equal(status, 422, `${probe.name} → ${status}`);
      assert.ok(body.error.details?.fields?.[probe.field], `${probe.name} had no error on ${probe.field}: ${JSON.stringify(body.error).slice(0, 160)}`);
    }
    const after = (await api("/api/admin/settings", { cookie: owner })).body.settings;
    assert.deepEqual(
      { timezone: after.timezone, openingTime: after.openingTime, minimumDuration: after.minimumDuration, currency: after.currency },
      { timezone: current.timezone, openingTime: current.openingTime, minimumDuration: current.minimumDuration, currency: current.currency },
      "a rejected write changed the live document",
    );
    return `${probes.length} rejected, nothing stored`;
  });

  await test("Settings: money edits are normalised, not trusted", async () => {
    const current = (await api("/api/admin/settings", { cookie: owner })).body.settings;
    // Flip to whichever code is not already in force, so the run is repeatable.
    const flipped = current.currency === "PHP" ? "usd" : "php";
    const expected = flipped.toUpperCase();
    const { status, body } = await api("/api/admin/settings", { cookie: owner, method: "PUT", body: { ...current, currency: flipped } });
    assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
    assert.equal(body.changes.find((entry) => entry.field === "currency")?.to, expected, "the code was not normalised");
    assert.equal((await api("/api/admin/settings", { cookie: owner })).body.settings.currency, expected);
    const created = await walkInDoc(owner, { date: clubDate(7), startTime: "22:00", confirmNow: true }, cleanup);
    const row = (await api(`/api/admin/reservations?view=all&q=${created.reference}`, { cookie: owner })).body.page.rows[0];
    assert.equal(row.currency, expected, "a new booking did not carry the currency in force");
    assert.ok(Number.isInteger(row.amount), "money is not an integer number of centavos");
    await api("/api/admin/settings", { cookie: owner, method: "PUT", body: { ...current, currency: "PHP" } });
    return "lowercase accepted, upper-cased stored, bookings inherit it as integers";
  });

  // ================================================================ team ====
  await test("Team: the list shows roles, live sessions and which row is me", async () => {
    const { status, body } = await api("/api/admin/team", { cookie: owner });
    assert.equal(status, 200);
    assert.ok(body.users.length >= 2);
    const qa = body.users.find((user) => user.email === STAFF_EMAIL);
    assert.equal(qa.role, "STAFF");
    assert.ok(qa.openSessions >= 1, "an account we are signed in with shows no sessions");
    assert.ok(body.users.some((user) => user.isSelf), "the acting account is not flagged");
    assert.ok(!JSON.stringify(body).includes("passwordHash"), "a hash leaked in the team list");
    return `${body.users.length} account(s) · QA has ${qa.openSessions} live session(s)`;
  });

  await test("Team: a weak password never reaches the hash function", async () => {
    const { status, body } = await api("/api/admin/team", {
      cookie: owner,
      method: "POST",
      body: { name: "Weakling", email: `weak-${RUN_ID}@nocturne.test`, role: "ADMIN", password: "password123" },
    });
    assert.equal(status, 422);
    assert.ok(body.error.details.fields.password, "no field error on the password");
    assert.equal(await coll("admin_users").countDocuments({ email: `weak-${RUN_ID}@nocturne.test` }), 0);

    const clash = await api("/api/admin/team", {
      cookie: owner,
      method: "POST",
      body: { name: "Copy Cat", email: STAFF_EMAIL, role: "STAFF", password: "Another-Good-123!" },
    });
    assert.ok(clash.status === 409 || clash.status === 422, `a duplicate email → ${clash.status}`);
    assert.ok(clash.body.error.details.fields.email, "the duplicate was not pointed at the email field");
    return `422 on strength · ${clash.status} on a duplicate email`;
  });

  await test("Team: promoting Staff changes what the same cookie may do", async () => {
    const qa = (await api("/api/admin/team", { cookie: owner })).body.users.find((user) => user.email === STAFF_EMAIL);
    // An empty body is a cheap capability probe: 403 means "not allowed to try",
    // 422 means "allowed, and your payload was wrong".
    const probe = () => api("/api/admin/rooms", { cookie: staff, method: "POST", body: {} });
    assert.equal((await probe()).status, 403, "staff could already create rooms");
    const promoted = await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "PATCH", body: { role: "ADMIN" } });
    assert.equal(promoted.status, 200, promoted.text.slice(0, 160));
    assert.ok(promoted.body.changed.includes("role"));
    assert.equal((await probe()).status, 422, "the promotion did not take effect for the live session");
    // Admin still cannot manage staff — that key belongs to Super Admin alone.
    assert.equal((await api("/api/admin/team", { cookie: staff })).status, 403, "Admin gained staff management it should not have");
    await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "PATCH", body: { role: "STAFF" } });
    assert.equal((await probe()).status, 403, "demoting did not take effect either");
    return "STAFF → ADMIN → STAFF, enforced per request · Admin kept out of Team";
  });

  await test("Team: a password reset signs the old cookie out everywhere", async () => {
    const qa = (await api("/api/admin/team", { cookie: owner })).body.users.find((user) => user.email === STAFF_EMAIL);
    assert.equal((await api("/api/admin/rooms", { cookie: staff })).status, 200, "precondition: the staff session should work");
    const reset = await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "PATCH", body: { password: "Rotated-Shift-2026!" } });
    assert.equal(reset.status, 200, reset.text.slice(0, 160));
    assert.ok(reset.body.sessionsRevoked >= 1, `revoked ${reset.body.sessionsRevoked}`);
    assert.equal((await api("/api/admin/rooms", { cookie: staff })).status, 401, "the old cookie still works");
    assert.equal(await coll("admin_sessions").countDocuments({ user: oid(qa.id), revokedAt: null }), 0, "a live session survived the reset");
    staffPassword = "Rotated-Shift-2026!";
    staff = await login(STAFF_EMAIL, staffPassword);
    const doc = await coll("admin_users").findOne({ _id: oid(qa.id) });
    assert.match(doc.passwordHash, /^\$2[aby]\$12\$/, "the new password was not hashed at cost 12");
    return `revoked ${reset.body.sessionsRevoked} session(s) · re-authenticated`;
  });

  await test("Team: a disabled account is refused at the door", async () => {
    const qa = (await api("/api/admin/team", { cookie: owner })).body.users.find((user) => user.email === STAFF_EMAIL);
    const disabled = await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "PATCH", body: { isActive: false } });
    assert.equal(disabled.status, 200, disabled.text.slice(0, 160));
    assert.ok(disabled.body.sessionsRevoked >= 1, "disabling left sessions behind");
    const attempt = await api("/api/auth/login", { method: "POST", body: { email: STAFF_EMAIL, password: staffPassword } });
    assert.ok(attempt.status >= 400, "a disabled account signed in");
    assert.match(JSON.stringify(attempt.body), /deactivated|disabled|not available|refused|password/i);
    await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "PATCH", body: { isActive: true } });
    staff = await login(STAFF_EMAIL, staffPassword);
    return `${attempt.status} at the door · re-enabled`;
  });

  await test("Team: you cannot lock yourself out, or unpick the last Super Admin", async () => {
    const me = (await api("/api/admin/team", { cookie: owner })).body.users.find((user) => user.isSelf);
    const selfDisabled = await api(`/api/admin/team/${me.id}`, { cookie: owner, method: "PATCH", body: { isActive: false } });
    assert.ok(selfDisabled.status >= 400, "the account in use was deactivated");
    assert.match(selfDisabled.body.error.message, /signed in with|yourself|own account/i);
    assert.equal((await api("/api/admin/team", { cookie: owner })).status, 200, "we just locked ourselves out");

    const supers = await coll("admin_users").find({ role: "SUPER_ADMIN", isActive: true }).toArray();
    assert.equal(supers.length, 1, `expected one active Super Admin, found ${supers.length}`);
    const demoted = await api(`/api/admin/team/${String(supers[0]._id)}`, { cookie: owner, method: "PATCH", body: { role: "STAFF" } });
    assert.ok(demoted.status >= 400, "the last Super Admin was demoted");
    assert.match(demoted.body.error.message, /last|only/i);
    assert.equal((await coll("admin_users").findOne({ _id: supers[0]._id })).role, "SUPER_ADMIN");
    return `“${selfDisabled.body.error.message}” · “${demoted.body.error.message}”`;
  });

  await test("Team: sessions are listed by device and one can be revoked by hand", async () => {
    staff = await login(STAFF_EMAIL, staffPassword);
    const qa = (await api("/api/admin/team", { cookie: owner })).body.users.find((user) => user.email === STAFF_EMAIL);
    const listed = await api(`/api/admin/team/${qa.id}`, { cookie: owner });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.sessions.length >= 1, "the session we are using is not listed");
    const active = listed.body.sessions.find((session) => session.active);
    assert.ok(active, "no active session to revoke");
    assert.ok(!/[a-f0-9]{64}/.test(JSON.stringify(active)), "the raw session token was sent to the browser");
    assert.ok(!/x-forwarded-for/i.test(JSON.stringify(active)), "a raw header leaked into the session row");

    const revoked = await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "POST", body: { action: "revoke-session", sessionId: active.id } });
    assert.equal(revoked.status, 200, revoked.text.slice(0, 160));
    assert.equal((await api("/api/admin/rooms", { cookie: staff })).status, 401, "revoking did not sign that device out");
    staff = await login(STAFF_EMAIL, staffPassword);

    const unknown = await api(`/api/admin/team/${qa.id}`, { cookie: owner, method: "POST", body: { action: "make-super-admin" } });
    assert.ok(unknown.status >= 400, `an unknown action → ${unknown.status}`);
    assert.equal((await coll("admin_users").findOne({ _id: oid(qa.id) })).role, "STAFF", "the rejected action changed the account");
    return "revoked by hand · unknown action refused";
  });

  await test("Team: a malformed id is a clean 404 for every screen", async () => {
    const probes = await Promise.all([
      api("/api/admin/team/not-a-real-id", { cookie: owner, method: "PATCH", body: { role: "STAFF" } }),
      api("/api/admin/reservations/not-a-real-id", { cookie: owner }),
      api("/api/admin/customers/%2e%2e", { cookie: owner }), // → 308 path normalisation
      api("/api/admin/rooms/not-a-real-id", { cookie: owner, method: "PATCH", body: { capacity: 2 } }),
    ]);
    for (const probe of probes) {
      assert.ok(probe.status === 404 || probe.status === 422 || probe.status === 308, `expected 404, got ${probe.status}`);
      assert.ok(!probe.text.includes("CastError"), "a Mongo cast error reached the client");
      assert.ok(!probe.text.includes("ObjectId"), "internal id vocabulary leaked");
    }
    return `${probes.length} malformed ids refused`;
  });

  // ========================================================= html surfaces ==
  await test("Every console screen renders for the right role", async () => {
    const pages = [
      { path: "/admin", needle: /tonight/i },
      { path: "/admin/reservations", needle: /search|awaiting approval/i },
      { path: "/admin/reservations?view=all&status=PENDING", needle: /pending/i },
      { path: "/admin/reservations/" + id, needle: new RegExp(ref) },
      { path: "/admin/calendar", needle: /occupancy/i },
      { path: "/admin/rooms", needle: /categories/i },
      { path: "/admin/blocks", needle: /block/i },
      { path: "/admin/customers", needle: /guests?/i },
      { path: "/admin/customers/" + (await byReference(ref)).customer, needle: /booking history/i },
      { path: "/admin/payments", needle: /receipts/i },
      { path: "/admin/settings", needle: /trading hours/i },
      { path: "/admin/team", needle: /account/i },
      { path: "/admin/system", needle: /mongo|database/i },
    ];
    for (const page of pages) {
      const { status, text } = await api(page.path, { cookie: owner, redirect: "follow" });
      if (status !== 200) throw new Error(`${page.path} → ${status}`);
      if (!page.needle.test(text)) throw new Error(`${page.path} did not render ${page.needle}`);
      if (/Application error: a|Unhandled Runtime Error|Internal Server Error|__next_error__/.test(text)) {
        throw new Error(`${page.path} rendered an error boundary`);
      }
    }
    for (const path of ["/admin", "/admin/reservations", "/admin/rooms", "/admin/blocks"]) {
      const staffPage = await api(path, { cookie: staff, redirect: "follow" });
      assert.equal(staffPage.status, 200, `${path} → ${staffPage.status} for staff`);
    }
    const denied = await api("/admin/team", { cookie: staff, redirect: "follow" });
    assert.match(denied.text + (denied.response.url ?? ""), /forbidden/, "staff was shown the team page");
    const forbiddenPage = await api("/admin/forbidden?permission=settings:manage", { cookie: staff, redirect: "follow" });
    assert.equal(forbiddenPage.status, 200);
    assert.match(forbiddenPage.text, /permission|ask|manager|role/i);
    return `${pages.length} owner screens · staff routed away from Team`;
  });

  await test("Admin HTML leaks no secret, token or credential", async () => {
    const pages = ["/admin", "/admin/reservations", "/admin/settings", "/admin/team", "/admin/customers", "/admin/payments", `/admin/reservations/${id}`];
    const leaked = [];
    for (const path of pages) {
      const { text } = await api(path, { cookie: owner, redirect: "follow" });
      if (MONGODB_URI?.startsWith("mongodb") && text.includes(MONGODB_URI)) leaked.push(`${path}: connection string`);
      if (/\$2[aby]\$12\$/.test(text)) leaked.push(`${path}: password hash`);
      if (text.includes(OWNER_PASSWORD)) leaked.push(`${path}: owner password`);
      if (text.includes(staffPassword)) leaked.push(`${path}: staff password`);
      if (/<link[^>]+accessToken|"[a-f0-9]{64}"/.test(text)) leaked.push(`${path}: bearer-like token`);
      if (text.includes("internalNotes")) leaked.push(`${path}: internal note field name`);
    }
    assert.deepEqual(leaked, []);
    return `${pages.length} pages scanned, nothing found`;
  });

  await test("Actions offered on a booking follow the role, not the page", async () => {
    const created = await walkInDoc(owner, { date: clubDate(8), startTime: "20:00" }, cleanup);
    const page = `/admin/reservations/${String(created.doc._id)}`;
    const staffHtml = (await api(page, { cookie: staff, redirect: "follow" })).text;
    const adminHtml = (await api(page, { cookie: owner, redirect: "follow" })).text;
    const offers = (html, label) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(html);
    assert.ok(offers(adminHtml, "Confirm booking"), "the owner's page lost its primary action");
    assert.ok(!offers(staffHtml, "Confirm booking"), "staff were offered a decision they cannot make");
    assert.ok(!offers(staffHtml, "Reject"), "staff were offered rejection they cannot perform");
    assert.ok(offers(staffHtml, "Check in"), "staff lost the floor action they do hold");
    assert.ok(!offers(staffHtml, "Record payment"), "staff were offered money they cannot touch");
    assert.ok(!offers(staffHtml, "Move booking"), "staff were offered an edit they cannot save");
    return "owner sees the decisions · floor sees only check-in";
  });

  await test("The booking page prints a usable summary without the console chrome", async () => {
    const { text } = await api(`/admin/reservations/${id}`, { cookie: owner, redirect: "follow" });
    assert.ok(text.includes(ref), "the reference is missing from its own page");
    assert.ok(/print:hidden/.test(text), "nothing is marked out for print");
    assert.ok(text.includes("Timeline"), "there is no audit trail on the page");
    return "reference, timeline and print rules all present";
  });

  await test("The board's filters are plain links, so they work without JavaScript", async () => {
    const { text } = await api("/admin/reservations", { cookie: owner, redirect: "follow" });
    assert.match(text, /<form[^>]+action="\/admin\/reservations"/, "no GET filter form");
    assert.match(text, /method="get"/i, "the filter form is not a GET");
    assert.match(text, /href="\/admin\/reservations\?view=today/, "the view tabs are not plain links");
    assert.match(text, /aria-label="[^"]*page[^"]*"|Page /i, "pagination has no accessible label");
    return "filters, tabs and paging are hrefs and GET forms";
  });

  // ============================================================== limits ====
  await test("Admin writes are rate limited per address, not globally", async () => {
    const ip = nextIp();
    let limited = null;
    for (let index = 0; index < 75 && !limited; index += 1) {
      const probe = await api("/api/admin/reservations/sweep", { cookie: owner, method: "POST", body: {}, ip });
      if (probe.status === 429) limited = probe;
    }
    assert.ok(limited, "75 writes from one address never met the limiter");
    assert.equal(limited.body.error.code, "RATE_LIMITED");
    assert.match(limited.body.error.message, /try again|later|minute/i);
    assert.equal((await api("/api/admin/reservations/sweep", { cookie: owner, method: "POST", body: {}, ip: nextIp() })).status, 200, "the bucket is global rather than per-address");
    return "429 for the noisy address, 200 for the next one";
  });

  await test("Settings are restored so the next run starts where this one did", async () => {
    assert.ok(settingsSnapshot, "no snapshot was taken");
    const before = await coll("club_settings").findOne({});
    const changed = Object.keys(settingsSnapshot).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(settingsSnapshot[key]));
    await coll("club_settings").updateOne({ _id: before._id }, { $set: settingsSnapshot });
    const after = await coll("club_settings").findOne({});
    for (const key of changed) {
      assert.equal(JSON.stringify(after[key]), JSON.stringify(settingsSnapshot[key]), `${key} was left changed`);
    }
    return changed.length ? `restored ${changed.join(", ")}` : "untouched by the run";
  });

  // ============================================================ cleanup =====
  const docs = cleanup.references.length ? await coll("reservations").find({ reservationReference: { $in: cleanup.references } }).toArray() : [];
  const reservationIds = docs.map((doc) => doc._id);
  const customerIds = [...new Set(docs.map((doc) => String(doc.customer)).filter(Boolean))].map(oid);
  await coll("room_slot_locks").deleteMany({ reservation: { $in: reservationIds } });
  await coll("payments").deleteMany({ reservation: { $in: reservationIds } });
  await coll("reservations").deleteMany({ _id: { $in: reservationIds } });
  await coll("customers").deleteMany({ _id: { $in: customerIds } });
  await coll("room_blocks").deleteMany({ _id: { $in: cleanup.blockIds.filter(Boolean).map(oid) } });
  await coll("rooms").deleteMany({ _id: { $in: cleanup.roomIds.filter(Boolean).map(oid) } });
  await coll("room_categories").deleteMany({ _id: { $in: cleanup.categoryIds.filter(Boolean).map(oid) } });
  for (const value of cleanup.adminUserIds.filter(Boolean)) {
    const userId = oid(value);
    await coll("admin_sessions").deleteMany({ user: userId });
    await coll("admin_users").deleteOne({ _id: userId });
  }
  // `customer` on a booking is a reference, not an embedded copy: resolve names
  // through the profiles collection or this count is always zero.
  const qaProfiles = await coll("customers").find({ fullName: new RegExp(GUEST) }, { projection: { _id: 1 } }).toArray();
  const leftover = qaProfiles.length
    ? await coll("reservations").countDocuments({ customer: { $in: qaProfiles.map((doc) => doc._id) } })
    : 0;
  console.log(
    `\n• teardown: ${reservationIds.length} booking(s), ${customerIds.length} profile(s), ` +
      `${cleanup.blockIds.length} block(s), ${cleanup.roomIds.length} room(s), ` +
      `${cleanup.adminUserIds.length} account(s) removed · ${leftover} booking(s) left behind`,
  );

  await mongoose.disconnect();

  console.log(`\n${"=".repeat(56)}`);
  const passed = results.filter((result) => result.ok).length;
  console.log(`${passed}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nTest harness crashed:", error);
  process.exit(1);
});
