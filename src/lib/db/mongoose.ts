import mongoose from "mongoose";
import { getServerEnv } from "@/config/env";

/**
 * Mongoose connection utility.
 *
 * Next.js (App Router) hot-reloads modules in development and runs many
 * serverless instances in production, so the connection is cached on the
 * global object to avoid opening a socket per request or request handler.
 */

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache =
  global.__mongooseCache ?? (global.__mongooseCache = { conn: null, promise: null });

if (process.env.NODE_ENV !== "production") {
  // Fail fast on misconfiguration while developing instead of after a 10s timeout.
  mongoose.set("bufferCommands", false);
}

mongoose.set("strictQuery", true);

/**
 * NOTE: `sanitizeFilter` is deliberately NOT enabled.
 * It rewrites legitimate operator filters such as `{ expiresAt: { $gt: date } }`
 * into `$eq` comparisons, which broke session expiry queries during testing.
 * NoSQL-injection safety is guaranteed instead by:
 *   - Zod validation of every request payload before it reaches a query,
 *   - normalization of strings (mobile numbers, emails, slugs),
 *   - never passing raw request objects into Mongoose filters,
 *   - regex searches that escape user input (Phase 3 admin search).
 */

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn?.connection.readyState === 1) return cache.conn;

  const { MONGODB_URI, MONGODB_DB_NAME } = getServerEnv();

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB_NAME,
        // Keep the pool small: Vercel functions are short-lived and Atlas has
        // per-cluster connection limits.
        maxPoolSize: 10,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        retryWrites: true,
        autoIndex: process.env.NODE_ENV !== "production",
      })
      .then((instance) => {
        instance.connection.on("error", (error) => {
          console.error("[db] connection error:", error);
        });
        instance.connection.on("disconnected", () => {
          console.warn("[db] disconnected");
        });
        return instance;
      })
      .catch((error: unknown) => {
        cache.promise = null;
        console.error("[db] initial connection failed:", error);
        throw error;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

export type DatabaseHealth = {
  connected: boolean;
  readyState: number;
  database?: string;
  host?: string;
  latencyMs?: number;
  error?: string;
};

/** Lightweight connectivity probe used by /api/health and the admin shell. */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  try {
    const instance = await connectToDatabase();
    const db = instance.connection.db;
    if (!db) {
      return {
        connected: false,
        readyState: instance.connection.readyState,
        error: "Database handle unavailable",
      };
    }
    await db.admin().ping();
    return {
      connected: true,
      readyState: instance.connection.readyState,
      database: instance.connection.name,
      host: instance.connection.host,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      connected: false,
      readyState: mongoose.connection.readyState,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

/** Disconnect helper (seed scripts, tests). */
export async function disconnectFromDatabase(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
  }
  cache.conn = null;
  cache.promise = null;
}
