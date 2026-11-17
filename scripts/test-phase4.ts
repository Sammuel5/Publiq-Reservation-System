import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Types } from "mongoose";
import { consumeRateLimit, resetRateLimit } from "../src/lib/rate-limit";
import { connectToDatabase, disconnectFromDatabase } from "../src/lib/db/mongoose";

const run = promisify(execFile);
const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const secret = process.env.CRON_SECRET;
const key = process.argv[3] ?? `phase4:${randomUUID()}`;

async function main() {
if (process.argv[2] === "worker") {
  const results = await Promise.all(Array.from({ length: 20 }, () => consumeRateLimit({ key, limit: 10, windowMs: 60_000 })));
  console.log(JSON.stringify(results.map((r) => r.success)));
  await disconnectFromDatabase();
} else {
  if (!secret) throw new Error("CRON_SECRET required for Phase 4 tests");
  const db = (await connectToDatabase()).connection.db!;
  const ids = [new Types.ObjectId(), new Types.ObjectId()];
  let failed = 0;
  async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); console.log(`✓ ${name}`); }
    catch (e) { failed++; console.error(`✗ ${name}`, e); }
  }
  try {
    await test("Concurrent requests across independent processes share one atomic bucket", async () => {
      const args = ["node_modules/tsx/dist/cli.mjs", "scripts/test-phase4.ts", "worker", key];
      const workers = await Promise.all([run(process.execPath, args), run(process.execPath, args)]);
      const results = workers.flatMap((w) => JSON.parse(w.stdout.trim()) as boolean[]);
      assert.equal(results.length, 40);
      assert.equal(results.filter(Boolean).length, 10);
      const result = await consumeRateLimit({ key, limit: 10, windowMs: 60_000 });
      assert.equal(result.success, false);
      assert.ok(result.retryAfterSeconds > 0);
    });
    await test("Expired buckets reset without relying on the TTL monitor", async () => {
      const short = `${key}:short`;
      try {
        assert.equal((await consumeRateLimit({ key: short, limit: 1, windowMs: 50 })).success, true);
        assert.equal((await consumeRateLimit({ key: short, limit: 1, windowMs: 50 })).success, false);
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal((await consumeRateLimit({ key: short, limit: 1, windowMs: 50 })).success, true);
      } finally { await resetRateLimit(short); }
    });
    await test("The scheduler requires the exact bearer secret", async () => {
      for (const path of ["expire-holds", "notifications"]) {
        for (const auth of [undefined, "Bearer incorrect"]) {
          const r = await fetch(`${BASE}/api/cron/${path}`, { headers: auth ? { Authorization: auth } : {} });
          assert.equal(r.status, 401);
        }
      }
      const allowed = await fetch(`${BASE}/api/cron/notifications`, { headers: { Authorization: `Bearer ${secret}` } });
      assert.equal(allowed.status, 200);
      assert.deepEqual((await allowed.json()).configured, []);
    });
    await test("Concurrent scheduled sweeps expire once and preserve live locks", async () => {
      const now = new Date();
      const room = new Types.ObjectId();
      await db.collection("reservations").insertMany([
        { _id: ids[0], status: "PENDING", pendingExpiresAt: new Date(now.getTime() - 60_000), statusHistory: [], reservationReference: `P4-${randomUUID()}`, submissionKey: `p4-${randomUUID()}` },
        { _id: ids[1], status: "CONFIRMED", pendingExpiresAt: null, statusHistory: [], reservationReference: `P4-${randomUUID()}` },
      ]);
      await db.collection("room_slot_locks").insertMany(ids.map((id, i) => ({ room, reservation: id, slotStart: new Date(now.getTime() + i * 1_800_000), slotEnd: new Date(now.getTime() + (i + 1) * 1_800_000), status: i ? "CONFIRMED" : "PENDING" })));
      const request = () => fetch(`${BASE}/api/cron/expire-holds`, { headers: { Authorization: `Bearer ${secret}` } });
      const responses = await Promise.all([request(), request()]);
      assert.deepEqual(responses.map((r) => r.status), [200, 200]);
      const values = await Promise.all(responses.map((r) => r.json()));
      assert.equal(values.reduce((a, v) => a + v.expired, 0), 1);
      const expired = await db.collection("reservations").findOne({ _id: ids[0] });
      assert.equal(expired?.status, "EXPIRED");
      assert.equal(expired?.statusHistory.length, 1);
      assert.equal(expired?.submissionKey, undefined);
      assert.equal(await db.collection("room_slot_locks").countDocuments({ reservation: ids[0] }), 0);
      assert.equal(await db.collection("room_slot_locks").countDocuments({ reservation: ids[1] }), 1);
      assert.equal((await (await request()).json()).expired, 0);
    });
    await test("Rate-limit cleanup index exists", async () => {
      const indexes = await db.collection("rate_limits").indexes();
      assert.ok(indexes.some((i) => i.name === "rate_limit_expiry" && i.expireAfterSeconds === 0));
    });
  } finally {
    await resetRateLimit(key);
    await db.collection("room_slot_locks").deleteMany({ reservation: { $in: ids } });
    await db.collection("reservations").deleteMany({ _id: { $in: ids } });
    await disconnectFromDatabase();
  }
  console.log(`${5-failed}/5 hardening checks passed`);
  if (failed) process.exitCode = 1;
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
