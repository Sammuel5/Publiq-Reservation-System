import { createHash } from "node:crypto";
import { connectToDatabase } from "@/lib/db/mongoose";
import { RateLimitError } from "@/lib/errors";

/** Shared fixed-window counters. The key is hashed before it reaches MongoDB.
 * Atomic pipeline updates ensure simultaneous requests and separate processes
 * consume the same bucket. Expired buckets reset in the update itself; TTL is
 * only for eventual storage cleanup, never correctness. Database failures are
 * deliberately fail-closed instead of silently disabling protection. */
export type RateLimitOptions = { key: string; limit: number; windowMs: number };
export type RateLimitResult = { success: boolean; remaining: number; resetAt: number; retryAfterSeconds: number };

export async function consumeRateLimit({ key, limit, windowMs }: RateLimitOptions): Promise<RateLimitResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Invalid rate-limit configuration");
  }
  const db = (await connectToDatabase()).connection.db;
  if (!db) throw new Error("Database unavailable for rate limiting");
  const id = createHash("sha256").update(key).digest("hex");
  const now = new Date();
  const reset = new Date(now.getTime() + windowMs);
  // _id's built-in unique index avoids a separate index-creation race.
  const collection = db.collection("rate_limits");
  const filter = { _id: id as never };
  const update = [{ $set: {
      count: { $cond: [{ $gt: [{ $ifNull: ["$expiresAt", new Date(0)] }, now] }, { $add: ["$count", 1] }, 1] },
      expiresAt: { $cond: [{ $gt: [{ $ifNull: ["$expiresAt", new Date(0)] }, now] }, "$expiresAt", reset] },
    } }];
  // Two first-time upserts can race on the _id index. The loser must still
  // consume the newly created counter rather than fail a legitimate request.
  let result;
  try {
    result = await collection.findOneAndUpdate(filter, update, { upsert: true, returnDocument: "after" });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    result = await collection.findOneAndUpdate(filter, update, { returnDocument: "after" });
  }
  if (!result) throw new Error("Rate-limit counter unavailable");
  const resetAt = new Date(result.expiresAt).getTime();
  return { success: result.count <= limit, remaining: Math.max(0, limit - result.count), resetAt, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)) };
}

export async function enforceRateLimit(options: RateLimitOptions): Promise<void> {
  const result = await consumeRateLimit(options);
  if (!result.success) throw new RateLimitError(result.retryAfterSeconds);
}

export async function resetRateLimit(key: string): Promise<void> {
  const db = (await connectToDatabase()).connection.db;
  if (!db) throw new Error("Database unavailable for rate limiting");
  await db.collection("rate_limits").deleteOne({ _id: createHash("sha256").update(key).digest("hex") as never });
}
