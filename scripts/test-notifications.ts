import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingNotifications, processNotifications } from "../src/lib/services/notifications";
import { connectToDatabase, disconnectFromDatabase } from "../src/lib/db/mongoose";

async function main() {
  // A disposable database ensures a simulated sender can never consume a real job.
  process.env.MONGODB_DB_NAME = `phase4_notifications_${randomUUID().replaceAll("-", "")}`;
  process.env.RESEND_API_KEY = "test-key";
  process.env.NOTIFICATION_FROM_EMAIL = "test@example.com";
  process.env.NOTIFICATION_STAFF_EMAIL = "staff@example.com";
  process.env.NOTIFICATIONS_SMS_ENABLED = "true"; // Explicitly test the legacy optional SMS path.
  process.env.TWILIO_ACCOUNT_SID = "test-sid";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  const db = (await connectToDatabase()).connection.db!;
  const originalFetch = globalThis.fetch;
  const sent: { url: string; idempotency: string | null; body: string }[] = [];
  let failNext = false;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), idempotency: new Headers(init?.headers).get("Idempotency-Key"), body: String(init?.body) });
    if (failNext) { failNext = false; return new Response("provider details must not persist", { status: 503 }); }
    return new Response("{}", { status: 200 });
  };
  let failed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}`, e); }
  };
  try {
    await test("Concurrent workers claim and send each email, SMS and staff job once", async () => {
      const jobs = bookingNotifications({ reference: "NK-TEST22", date: "2026-12-01", time: "20:00", room: "Gold Room", roomId: "room-1", mobile: "+639171234567", email: "guest@example.com", confirmed: false, staff: true });
      assert.equal(jobs.length, 3);
      const doc = await db.collection("reservations").insertOne({ status: "PENDING", reservationDate: "2026-12-01", startTime: "20:00", room: "room-1", pendingExpiresAt: new Date(Date.now() + 60_000), notifications: jobs });
      await Promise.all([processNotifications(10), processNotifications(10)]);
      const saved = await db.collection("reservations").findOne({ _id: doc.insertedId });
      assert.deepEqual(saved?.notifications.map((j: { state: string }) => j.state), ["sent", "sent", "sent"]);
      assert.equal(sent.length, 3);
      assert.equal(sent.filter((s) => s.url.includes("twilio.com")).length, 1);
      assert.equal(sent.filter((s) => s.url.includes("resend.com") && s.idempotency).length, 2);
    });
    await test("Failures are retained with backoff and can be retried", async () => {
      const jobs = bookingNotifications({ reference: "NK-TEST23", date: "2026-12-01", time: "20:00", room: "Gold Room", roomId: "room-1", mobile: "+639171234567", confirmed: true });
      const doc = await db.collection("reservations").insertOne({ status: "CONFIRMED", reservationDate: "2026-12-01", startTime: "20:00", room: "room-1", notifications: jobs });
      failNext = true;
      const first = await processNotifications(1);
      assert.equal(first.failed, 1);
      let saved = await db.collection("reservations").findOne({ _id: doc.insertedId });
      assert.equal(saved?.notifications[0].state, "pending");
      assert.equal(saved?.notifications[0].attempts, 1);
      assert.ok(saved?.notifications[0].nextAttemptAt > new Date());
      assert.equal(saved?.notifications[0].lastError, "Provider HTTP 503");
      await db.collection("reservations").updateOne({ _id: doc.insertedId }, { $set: { "notifications.0.nextAttemptAt": new Date(0) } });
      await processNotifications(1);
      saved = await db.collection("reservations").findOne({ _id: doc.insertedId });
      assert.equal(saved?.notifications[0].state, "sent");
      assert.equal(saved?.notifications[0].attempts, 2);
    });
    await test("Obsolete pending messages are skipped after cancellation", async () => {
      const jobs = bookingNotifications({ reference: "NK-TEST24", date: "2026-12-01", time: "20:00", room: "Gold Room", roomId: "room-1", mobile: "+639171234567", confirmed: false });
      const doc = await db.collection("reservations").insertOne({ status: "CANCELLED", reservationDate: "2026-12-01", startTime: "20:00", room: "room-1", notifications: jobs });
      const before = sent.length;
      await processNotifications(1);
      assert.equal(sent.length, before);
      const saved = await db.collection("reservations").findOne({ _id: doc.insertedId });
      assert.equal(saved?.notifications[0].state, "skipped");
    });
    await test("An unconfigured provider leaves work queued", async () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      const jobs = bookingNotifications({ reference: "NK-TEST25", date: "2026-12-01", time: "20:00", room: "Gold Room", roomId: "room-1", mobile: "+639171234567", confirmed: true });
      const doc = await db.collection("reservations").insertOne({ status: "CONFIRMED", reservationDate: "2026-12-01", startTime: "20:00", room: "room-1", notifications: jobs });
      await processNotifications(1);
      const saved = await db.collection("reservations").findOne({ _id: doc.insertedId });
      assert.equal(saved?.notifications[0].state, "pending");
    });
  } finally { globalThis.fetch = originalFetch; await db.dropDatabase(); await disconnectFromDatabase(); }
  console.log(`${4-failed}/4 notification checks passed`);
  if (failed) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
