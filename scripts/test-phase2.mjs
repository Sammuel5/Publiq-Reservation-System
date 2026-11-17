/**
 * Phase 2 verification — customer website + booking flow.
 *
 * Runs against a LIVE server and a real database. Everything is exercised over
 * HTTP exactly as the browser does it; assertions that need ground truth read
 * MongoDB directly.
 *
 *   npm run build && npm start &
 *   npm run test:phase2
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME ?? "ktv_club";
const TZ = process.env.CLUB_TIMEZONE ?? "Asia/Manila";

// Letters only: the name validator intentionally rejects digits and symbols.
const RUN = "Guest"
const SUFFIX = String(Date.now()).slice(-4);
const NAME_STEM = "Test Guest";
const randomOctet = () => Math.floor(Math.random() * 250) + 2;
/** Test-only documentation range; a fresh address per request keeps the per-IP limiter out of the way. */
const nextIp = () => `198.18.${randomOctet()}.${randomOctet()}`;

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

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "X-Forwarded-For": options.ip ?? nextIp(),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body, text };
}

function clubDate(offsetDays = 0) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  return formatter.format(base); // en-CA → YYYY-MM-DD
}

let phoneCounter = 0;

/**
 * A fresh, valid PH mobile per call. Must be unique per run: the API rate-limits
 * reservations per mobile number (5/hour), so reusing a fixed number would make
 * repeat runs fail on the limiter rather than on the behaviour under test.
 */
function futurePhone() {
  phoneCounter += 1;
  const tail = `${String(Date.now()).slice(-6)}${String(phoneCounter).padStart(2, "0")}`;
  return `09${tail.slice(-9).padStart(9, "4")}`;
}

async function main() {
  assert.ok(MONGODB_URI, "MONGODB_URI missing");
  console.log(`\nPhase 2 verification against ${BASE}\n${"=".repeat(54)}`);

  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  // --------------------------------------------------------------- fixtures --
  // Remove anything a previous run of this suite left behind, so the suite is
  // repeatable. Only records whose customer name matches the test markers are
  // touched — demo/seed data is never affected.
  const TEST_NAME_RE = /^(Test Guest|Second Guest|Price Probe|Big Group|Early Bird|Time Traveller|No Policy|Cutoff Probe|Rate Probe|Slot Reclaim)/;
  const staleCustomers = await db
    .collection("customers")
    .find({ fullName: TEST_NAME_RE }, { projection: { _id: 1 } })
    .toArray();
  if (staleCustomers.length > 0) {
    const staleIds = staleCustomers.map((doc) => doc._id);
    const staleReservations = await db
      .collection("reservations")
      .find({ customer: { $in: staleIds } }, { projection: { _id: 1 } })
      .toArray();
    const staleReservationIds = staleReservations.map((doc) => doc._id);
    await db.collection("room_slot_locks").deleteMany({ reservation: { $in: staleReservationIds } });
    await db.collection("payments").deleteMany({ reservation: { $in: staleReservationIds } });
    await db.collection("reservations").deleteMany({ _id: { $in: staleReservationIds } });
    await db.collection("customers").deleteMany({ _id: { $in: staleIds } });
    console.log(`• cleaned ${staleReservationIds.length} reservation(s) from a previous run\n`);
  }
  await db
    .collection("club_settings")
    .updateOne({ singleton: true }, { $set: { cancellationCutoffHours: 4 } });

  const date = clubDate(3); // a few days out: plenty of free rooms, still in range
  const duration = 120;

  // ------------------------------------------------------------- public pages --
  await test("Homepage renders branding, rooms and CTAs", async () => {
    const { response, text } = await api("/");
    assert.equal(response.status, 200);
    assert.ok(text.includes("PUBLIQ"), "club name missing");
    assert.ok(text.includes("Reserve now"), "primary CTA missing");
    assert.ok(text.includes("Sapphire Room"), "featured room missing");
    return `${Math.round(text.length / 1024)} kB`;
  });

  await test("Rooms index lists every bookable room", async () => {
    const { response, text } = await api("/rooms");
    assert.equal(response.status, 200);
    for (const name of ["Sapphire Room", "Velvet Suite", "PUBLIQ Premium", "The Parlour"]) {
      assert.ok(text.includes(name), `${name} missing from listing`);
    }
    return "4 tiers listed";
  });

  await test("Room detail page renders gallery, amenities and rate", async () => {
    const { response, text } = await api("/rooms/velvet-suite");
    assert.equal(response.status, 200);
    assert.ok(text.includes("Velvet Suite"));
    assert.ok(text.includes("₱1,800.00"), "rate not formatted");
    assert.ok(text.includes("Dedicated host"), "amenity missing");
    assert.ok(text.includes("Reserve this room"));
    return "200 OK";
  });

  await test("Unknown room slug returns 404", async () => {
    const { response } = await api("/rooms/does-not-exist");
    assert.equal(response.status, 404);
    return "404";
  });

  await test("Reservation wizard page renders", async () => {
    const { response, text } = await api("/reserve");
    assert.equal(response.status, 200);
    assert.ok(text.includes("Reserve your room"));
    assert.ok(text.includes("Date &amp; time") || text.includes("Date & time"));
    return "200 OK";
  });

  // ------------------------------------------------------------ availability --
  let slotTime = null;
  let roomSlug = null;
  let openSlots = [];
  let primaryRoomRate = 0;

  await test("Availability API returns bookable slots for a future date", async () => {
    const { response, body } = await api(`/api/availability?date=${date}&duration=${duration}`);
    assert.equal(response.status, 200);
    assert.equal(body.operating.isOpen, true);
    assert.ok(body.slots.length > 0, "no slots generated");
    const open = body.slots
      .filter((slot) => slot.available)
      .sort((a, b) => b.roomsAvailable - a.roomsAvailable);
    assert.ok(open.length > 6, "expected several open slots");
    openSlots = open.map((slot) => slot.time);
    slotTime = openSlots[2];
    return `${body.slots.length} slots, ${open.length} open`;
  });

  await test("Availability API lists rooms for a chosen window", async () => {
    const { response, body } = await api(
      `/api/availability?date=${date}&duration=${duration}&startTime=${slotTime}&guests=4`,
    );
    assert.equal(response.status, 200);
    assert.ok(body.rooms.length >= 4, "rooms missing");
    const free = body.rooms.filter((room) => room.available);
    assert.ok(free.length >= 1, `expected at least one free room, got ${free.length}`);
    roomSlug = free[0].slug;
    primaryRoomRate = free[0].hourlyRate;
    assert.ok(free[0].estimatedAmount > 0, "price not estimated");
    return `${free.length}/${body.rooms.length} rooms free`;
  });

  await test("Invalid date is rejected with 422", async () => {
    const { response, body } = await api(`/api/availability?date=2026-13-45`);
    assert.equal(response.status, 422);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    return "422";
  });

  // ---------------------------------------------------------------- booking ---
  const primaryMobile = futurePhone(1);
  let primaryReference = null;
  let primaryToken = null;
  let primaryId = null;

  await test("Customer can submit a reservation (PENDING, server-priced)", async () => {
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug,
        date,
        startTime: slotTime,
        durationMinutes: duration,
        fullName: `${NAME_STEM} ${RUN} ${String.fromCharCode(65 + (Number(SUFFIX) % 26))}${String.fromCharCode(65 + (Number(SUFFIX) % 17))}`,
        mobileNumber: primaryMobile,
        email: "guest@example.com",
        guestCount: 4,
        specialRequests: "Window table please",
        acceptPolicy: true,
      }),
    });

    assert.equal(response.status, 201);
    const reservation = body.reservation;
    assert.equal(reservation.status, "PENDING");
    assert.match(reservation.reference, /^NK-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    assert.equal(reservation.estimatedAmount, primaryRoomRate * (duration / 60));
    assert.ok(body.accessToken && body.accessToken.length >= 32, "access token missing");
    assert.ok(reservation.pendingExpiresAt, "pending expiry not set");

    primaryReference = reservation.reference;
    primaryToken = body.accessToken;

    const stored = await db.collection("reservations").findOne({
      reservationReference: primaryReference,
    });
    assert.ok(stored, "reservation not persisted");
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.estimatedAmount, reservation.estimatedAmount);
    assert.deepEqual(stored.notifications.map((item) => item.channel).sort(), ["email", "sms", "staff"]);
    assert.ok(stored.notifications.every((item) => item.state === "pending" && item.expectedStatus === "PENDING"));
    assert.ok(!JSON.stringify(body).includes("notifications"), "outbox leaked to guest API");
    primaryId = String(stored._id);

    const customer = await db.collection("customers").findOne({ _id: stored.customer });
    assert.ok(customer, "customer not created");
    assert.match(customer.mobileNumber, /^\+639\d{9}$/, "mobile not normalized");

    const locks = await db
      .collection("room_slot_locks")
      .countDocuments({ reservation: stored._id });
    assert.ok(locks >= 4, `expected slot locks, got ${locks}`);

    return `${primaryReference} · ${reservation.estimatedAmount / 100} PHP · ${locks} locks`;
  });

  await test("Identical submission is idempotent (no duplicate booking)", async () => {
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug,
        date,
        startTime: slotTime,
        durationMinutes: duration,
        fullName: `${NAME_STEM} ${RUN} ${String.fromCharCode(65 + (Number(SUFFIX) % 26))}${String.fromCharCode(65 + (Number(SUFFIX) % 17))}`,
        mobileNumber: primaryMobile,
        email: "guest@example.com",
        guestCount: 4,
        specialRequests: "Window table please",
        acceptPolicy: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(body.duplicate, true);
    assert.equal(body.reservation.reference, primaryReference);
    return "same reference returned";
  });

  await test("The booked room is no longer offered for that window", async () => {
    const { body } = await api(
      `/api/availability?date=${date}&duration=${duration}&startTime=${slotTime}&guests=4`,
    );
    const room = body.rooms.find((candidate) => candidate.slug === roomSlug);
    assert.equal(room.available, false);
    assert.equal(room.code, "CONFLICT");
    return "CONFLICT";
  });

  await test("A second customer cannot double-book the same room", async () => {
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug,
        date,
        startTime: slotTime,
        durationMinutes: duration,
        fullName: "Second Guest",
        mobileNumber: futurePhone(2),
        guestCount: 2,
        acceptPolicy: true,
      }),
    });
    assert.equal(response.status, 409);
    assert.match(body.error.message, /already reserved|just taken|not available/i);
    return `${response.status} · ${body.error.code}`;
  });

  await test("No orphaned slot locks exist after failed attempts", async () => {
    const lockReservationIds = await db
      .collection("room_slot_locks")
      .distinct("reservation");
    const existing = await db
      .collection("reservations")
      .find({ _id: { $in: lockReservationIds } }, { projection: { _id: 1 } })
      .toArray();
    const existingIds = new Set(existing.map((doc) => String(doc._id)));
    const orphans = lockReservationIds.filter((id) => !existingIds.has(String(id)));
    assert.equal(orphans.length, 0, `${orphans.length} lock(s) point at no reservation`);
    return `${lockReservationIds.length} lock groups, 0 orphans`;
  });

  await test("Server recalculates price and ignores client-sent amounts", async () => {
    const probeSlot = openSlots[6];
    const probeRooms = (
      await api(`/api/availability?date=${date}&duration=60&startTime=${probeSlot}&guests=2`)
    ).body.rooms.filter((room) => room.available);
    assert.ok(probeRooms.length > 0, "no free room for the price probe");
    const probeRoom = probeRooms[0];

    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug: probeRoom.slug,
        date,
        startTime: probeSlot,
        durationMinutes: 60,
        fullName: "Price Probe",
        mobileNumber: futurePhone(3),
        guestCount: 2,
        estimatedAmount: 1, // hostile client value
        acceptPolicy: true,
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(body.reservation.estimatedAmount, probeRoom.hourlyRate);
    assert.notEqual(body.reservation.estimatedAmount, 1);
    return `ignored client amount, priced ${body.reservation.estimatedAmount} (${probeRoom.slug})`;
  });

  await test("Capacity is enforced server-side", async () => {
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug: "sapphire-room",
        date,
        startTime: slotTime,
        durationMinutes: 60,
        fullName: "Big Group",
        mobileNumber: futurePhone(4),
        guestCount: 20, // room fits 6
        acceptPolicy: true,
      }),
    });
    assert.equal(response.status, 409);
    assert.equal(body.error.details?.code, "CAPACITY");
    return "rejected 20 guests for a 6-guest room";
  });

  await test("Bookings outside operating hours are rejected", async () => {
    const { response } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug: "onyx-room",
        date,
        startTime: "05:00", // club opens 14:00
        durationMinutes: 60,
        fullName: "Early Bird",
        mobileNumber: futurePhone(5),
        guestCount: 2,
        acceptPolicy: true,
      }),
    });
    assert.equal(response.status, 409);
    return "05:00 rejected";
  });

  await test("Past dates are rejected", async () => {
    const { response } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug: "onyx-room",
        date: clubDate(-1),
        startTime: "20:00",
        durationMinutes: 60,
        fullName: "Time Traveller",
        mobileNumber: futurePhone(6),
        guestCount: 2,
        acceptPolicy: true,
      }),
    });
    assert.equal(response.status, 409);
    return `${response.status}`;
  });

  await test("Missing policy acceptance is rejected with 422", async () => {
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug: "onyx-room",
        date,
        startTime: slotTime,
        durationMinutes: 60,
        fullName: "No Policy",
        mobileNumber: futurePhone(7),
        guestCount: 2,
      }),
    });
    assert.equal(response.status, 422);
    assert.ok(JSON.stringify(body.error.details).includes("cancellation policy"));
    return "422";
  });

  // ----------------------------------------------------------- confirmation ---
  await test("Confirmation page opens with its one-time token", async () => {
    const { response, text } = await api(`/confirmation/${primaryReference}?t=${primaryToken}`);
    assert.equal(response.status, 200);
    assert.ok(text.includes(primaryReference), "reference not shown");
    assert.ok(text.includes("held"), "confirmation copy missing");
    assert.ok(text.includes("Pending"));
    return "200 OK";
  });

  await test("Confirmation page leaks nothing without the token", async () => {
    const { response, text } = await api(`/confirmation/${primaryReference}`);
    assert.equal(response.status, 200);
    assert.ok(!text.includes(primaryMobile), "mobile leaked");
    assert.ok(!text.includes("Window table please"), "special requests leaked");
    assert.ok(text.includes("expired"), "expected the expired-link state");
    return "no data without token";
  });

  // ----------------------------------------------------------------- lookup ---
  await test("Lookup returns the reservation with a masked mobile", async () => {
    const { response, body } = await api("/api/reservations/lookup", {
      method: "POST",
      body: JSON.stringify({ reference: primaryReference, mobileNumber: primaryMobile }),
    });
    assert.equal(response.status, 200);
    assert.equal(body.reservation.reference, primaryReference);
    assert.match(body.reservation.mobileMasked, /^••••••\d{4}$/);
    assert.equal(body.reservation.internalNotes, undefined, "internal notes exposed");
    assert.equal(body.reservation.accessToken, undefined, "token exposed");
    return body.reservation.mobileMasked;
  });

  await test("Lookup with the wrong mobile is indistinguishable from unknown reference", async () => {
    const wrongMobile = await api("/api/reservations/lookup", {
      method: "POST",
      body: JSON.stringify({ reference: primaryReference, mobileNumber: futurePhone(8) }),
    });
    const unknownRef = await api("/api/reservations/lookup", {
      method: "POST",
      body: JSON.stringify({ reference: "NK-ZZZZZZ", mobileNumber: primaryMobile }),
    });
    assert.equal(wrongMobile.response.status, 404);
    assert.equal(unknownRef.response.status, 404);
    assert.equal(wrongMobile.body.error.message, unknownRef.body.error.message);
    return "identical responses";
  });

  // ----------------------------------------------------------- cancellation ---
  await test("Cancellation outside the cutoff cancels immediately and frees the room", async () => {
    const { response, body } = await api("/api/reservations/cancel", {
      method: "POST",
      body: JSON.stringify({
        reference: primaryReference,
        mobileNumber: primaryMobile,
        reason: "Plans changed",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(body.mode, "CANCELLED");
    assert.equal(body.reservation.status, "CANCELLED");

    const locks = await db
      .collection("room_slot_locks")
      .countDocuments({ reservation: new mongoose.Types.ObjectId(primaryId) });
    assert.equal(locks, 0, "slot locks not released");

    const availability = await api(
      `/api/availability?date=${date}&duration=${duration}&startTime=${slotTime}&guests=4`,
    );
    const room = availability.body.rooms.find((candidate) => candidate.slug === roomSlug);
    assert.equal(room.available, true, "room did not become available again");

    const history = await db
      .collection("reservations")
      .findOne({ reservationReference: primaryReference });
    assert.ok(
      history.statusHistory.some((entry) => entry.to === "CANCELLED" && entry.actorType === "CUSTOMER"),
      "cancellation not recorded in history",
    );
    return "CANCELLED · locks released · history recorded";
  });

  await test("A cancelled reservation cannot be cancelled twice", async () => {
    const { response } = await api("/api/reservations/cancel", {
      method: "POST",
      body: JSON.stringify({ reference: primaryReference, mobileNumber: primaryMobile }),
    });
    assert.equal(response.status, 409);
    return "409";
  });

  await test("A cancelled booking can be rebooked for the same room and time", async () => {
    // Regression: the idempotency key used to be owned forever by the cancelled
    // reservation, so a genuine rebooking silently returned the dead one.
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug,
        date,
        startTime: slotTime,
        durationMinutes: duration,
        fullName: `Test Guest ${RUN} ${String.fromCharCode(65 + (Number(SUFFIX) % 26))}${String.fromCharCode(65 + (Number(SUFFIX) % 17))}`,
        mobileNumber: primaryMobile,
        guestCount: 4,
        acceptPolicy: true,
      }),
    });

    assert.equal(
      response.status,
      201,
      `rebooking was not created: ${response.status} ${JSON.stringify(body?.error ?? body)}`,
    );
    assert.equal(body.duplicate, false);
    assert.notEqual(body.reservation.reference, primaryReference);
    assert.equal(body.reservation.status, "PENDING");

    // The new booking holds the slot again.
    const availability = await api(
      `/api/availability?date=${date}&duration=${duration}&startTime=${slotTime}&guests=4`,
    );
    const room = availability.body.rooms.find((candidate) => candidate.slug === roomSlug);
    assert.equal(room.available, false);

    primaryReference = body.reservation.reference;
    primaryToken = body.accessToken;
    return `${body.reservation.reference} (was ${body.duplicate})`;
  });

  await test("An expired pending hold does not keep a slot from the next guest", async () => {
    // Regression: availability releases a PENDING hold the moment
    // `pendingExpiresAt` passes, but its room_slot_locks rows stayed behind, so
    // the next guest was offered the slot and then rejected by the unique index.
    const held = await db.collection("reservations").findOne({ reservationReference: primaryReference });
    assert.ok(held, "rebooked reservation missing");

    await db
      .collection("reservations")
      .updateOne({ _id: held._id }, { $set: { pendingExpiresAt: new Date(Date.now() - 60_000) } });

    const locksBefore = await db
      .collection("room_slot_locks")
      .countDocuments({ reservation: held._id });
    assert.ok(locksBefore > 0, "the dead hold owns no lock rows — setup is wrong");

    const availability = await api(
      `/api/availability?date=${date}&duration=${duration}&startTime=${slotTime}&guests=4`,
    );
    const offered = availability.body.rooms.find((candidate) => candidate.slug === roomSlug);
    assert.equal(offered.available, true, "expired hold still blocks availability");

    const reclaimMobile = futurePhone();
    const { response, body } = await api("/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        roomSlug,
        date,
        startTime: slotTime,
        durationMinutes: duration,
        fullName: "Slot Reclaim",
        mobileNumber: reclaimMobile,
        guestCount: 4,
        acceptPolicy: true,
      }),
    });
    assert.equal(
      response.status,
      201,
      `slot could not be reclaimed: ${response.status} ${JSON.stringify(body?.error ?? body)}`,
    );
    assert.equal(body.duplicate, false);

    const locksAfter = await db.collection("room_slot_locks").countDocuments({ reservation: held._id });
    assert.equal(locksAfter, 0, "expired locks were not cleaned up");

    await api("/api/reservations/cancel", {
      method: "POST",
      body: JSON.stringify({
        reference: body.reservation.reference,
        mobileNumber: reclaimMobile,
        reason: "Test cleanup",
      }),
    });

    return `${locksBefore} stale lock(s) released, ${body.reservation.reference} booked`;
  });

  await test("Inside the cutoff window a cancellation becomes a staff request", async () => {
    // Temporarily raise the cutoff so the policy path is deterministic.
    const original = await db.collection("club_settings").findOne({ singleton: true });
    await db
      .collection("club_settings")
      .updateOne({ singleton: true }, { $set: { cancellationCutoffHours: 200 } });

    try {
      const cutoffMobile = futurePhone();
      const cutoffSlot = openSlots[10];
      const cutoffRoom = (
        await api(`/api/availability?date=${date}&duration=120&startTime=${cutoffSlot}&guests=4`)
      ).body.rooms.find((room) => room.available);
      assert.ok(cutoffRoom, "no free room for the cutoff probe");

      const booking = await api("/api/reservations", {
        method: "POST",
        body: JSON.stringify({
          roomSlug: cutoffRoom.slug,
          date,
          startTime: cutoffSlot,
          durationMinutes: 120,
          fullName: "Cutoff Probe",
          mobileNumber: cutoffMobile,
          guestCount: 4,
          acceptPolicy: true,
        }),
      });
      assert.equal(
        booking.response.status,
        201,
        `setup booking failed: ${booking.response.status} ${JSON.stringify(booking.body?.error ?? booking.body)}`,
      );

      const cancel = await api("/api/reservations/cancel", {
        method: "POST",
        body: JSON.stringify({
          reference: booking.body.reservation.reference,
          mobileNumber: cutoffMobile,
          reason: "Within cutoff",
        }),
      });

      assert.equal(cancel.response.status, 200);
      assert.equal(cancel.body.mode, "REQUESTED");
      assert.equal(cancel.body.reservation.cancellation.status, "PENDING");

      const stored = await db.collection("reservations").findOne({
        reservationReference: booking.body.reservation.reference,
      });
      assert.equal(stored.status, "PENDING", "status changed without approval");
      assert.equal(stored.cancellationRequest.status, "PENDING");

      return "queued for approval, status untouched";
    } finally {
      await db
        .collection("club_settings")
        .updateOne(
          { singleton: true },
          { $set: { cancellationCutoffHours: original.cancellationCutoffHours } },
        );
    }
  });

  await test("Booking submissions are rate limited", async () => {
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      const { response } = await api("/api/reservations", {
        method: "POST",
        ip: `203.0.113.${randomOctet()}`,
        body: JSON.stringify({
          roomSlug: "nonexistent-room",
          date,
          startTime: slotTime,
          durationMinutes: 60,
          fullName: "Rate Probe",
          mobileNumber: futurePhone(20 + i),
          guestCount: 2,
          acceptPolicy: true,
        }),
      });
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(429), `never rate limited: ${statuses.join(",")}`);
    return `statuses ${[...new Set(statuses)].join(",")}`;
  });

  // -------------------------------------------------------------- privacy ---
  await test("No internal fields or secrets leak into public HTML", async () => {
    const pages = ["/", "/rooms", "/rooms/velvet-suite", "/reserve", "/lookup"];
    for (const page of pages) {
      const { text } = await api(page);
      assert.ok(!text.includes("passwordHash"), `passwordHash in ${page}`);
      assert.ok(!text.includes("internalNotes"), `internalNotes in ${page}`);
      assert.ok(!text.includes("MONGODB_URI"), `env name in ${page}`);
      if (MONGODB_URI.startsWith("mongodb")) {
        assert.ok(!text.includes(MONGODB_URI), `connection string in ${page}`);
      }
    }
    return `${pages.length} pages scanned`;
  });

  // --------------------------------------------------------------- teardown --
  const createdCustomers = await db
    .collection("customers")
    .find({ fullName: TEST_NAME_RE }, { projection: { _id: 1 } })
    .toArray();
  const createdCustomerIds = createdCustomers.map((doc) => doc._id);
  const createdReservations = await db
    .collection("reservations")
    .find({ customer: { $in: createdCustomerIds } }, { projection: { _id: 1 } })
    .toArray();
  const createdReservationIds = createdReservations.map((doc) => doc._id);
  await db.collection("room_slot_locks").deleteMany({ reservation: { $in: createdReservationIds } });
  await db.collection("payments").deleteMany({ reservation: { $in: createdReservationIds } });
  await db.collection("reservations").deleteMany({ _id: { $in: createdReservationIds } });
  await db.collection("customers").deleteMany({ _id: { $in: createdCustomerIds } });
  console.log(`\n• teardown: removed ${createdReservationIds.length} test reservation(s)`);

  await mongoose.disconnect();

  console.log(`\n${"=".repeat(54)}`);
  const passed = results.filter((result) => result.ok).length;
  console.log(`${passed}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nTest harness crashed:", error);
  process.exit(1);
});
