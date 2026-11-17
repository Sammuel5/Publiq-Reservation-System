import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "../src/lib/db/mongoose";

async function main() {
  process.env.MONGODB_DB_NAME = `phase4_plans_${randomUUID().replaceAll("-", "")}`;
  const db = (await connectToDatabase()).connection.db!;
  try {
    const c = db.collection("reservations");
    await c.createIndex({ status: 1, pendingExpiresAt: 1 }, { name: "pending_expiry" });
    await c.createIndex({ room: 1, status: 1, startAt: 1, endAt: 1 }, { name: "room_availability" });
    const rooms = Array.from({ length: 50 }, () => new Types.ObjectId());
    const now = Date.now();
    const bulk = Array.from({ length: 15000 }, (_, i) => ({
      room: rooms[i % rooms.length], status: i % 20 === 0 ? "PENDING" : i % 3 === 0 ? "CONFIRMED" : "COMPLETED",
      pendingExpiresAt: i % 20 === 0 ? new Date(now + (i < 100 ? -60_000 : 3_600_000)) : null,
      startAt: new Date(now + i * 1_800_000), endAt: new Date(now + (i + 2) * 1_800_000),
    }));
    await c.insertMany(bulk);
    const cases: Array<{ name: string; filter: Record<string, unknown>; sort: Record<string, 1 | -1>; index: string }> = [
      { name: "expiry", filter: { status: "PENDING", pendingExpiresAt: { $ne: null, $lte: new Date(now) } }, sort: { pendingExpiresAt: 1 as const }, index: "pending_expiry" },
      { name: "room availability", filter: { room: rooms[40], status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startAt: { $lt: new Date(now + 100 * 1_800_000) }, endAt: { $gt: new Date(now + 80 * 1_800_000) } }, sort: { startAt: 1 as const }, index: "room_availability" },
    ];
    for (const item of cases) {
      const explain = await c.find(item.filter).sort(item.sort).explain("executionStats");
      const plan = JSON.stringify(explain.queryPlanner.winningPlan);
      assert.ok(plan.includes(item.index), `${item.name} did not use ${item.index}: ${plan}`);
      const stats = explain.executionStats;
      assert.ok(stats.totalDocsExamined < 500, `${item.name} scanned ${stats.totalDocsExamined} documents`);
      console.log(`✓ ${item.name}: ${item.index}, ${stats.nReturned} returned, ${stats.totalKeysExamined} keys and ${stats.totalDocsExamined} documents examined of 15,000`);
    }
  } finally { await db.dropDatabase(); await disconnectFromDatabase(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
