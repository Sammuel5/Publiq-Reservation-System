/**
 * Minimal structured logger.
 *
 * Deliberately dependency-free; on Vercel these lines land in the function logs.
 * Never pass secrets, passwords, session tokens or full customer records here.
 */

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, meta?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta === undefined ? {} : { meta: safeMeta(meta) }),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function safeMeta(meta: unknown): unknown {
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message, stack: meta.stack };
  }
  if (typeof meta === "object" && meta !== null) {
    try {
      return JSON.parse(JSON.stringify(meta));
    } catch {
      return String(meta);
    }
  }
  return meta;
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== "production") write("debug", scope, message, meta);
  },
  info: (scope: string, message: string, meta?: unknown) => write("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => write("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => write("error", scope, message, meta),
};
