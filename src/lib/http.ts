import { maskIp } from "@/lib/auth/session";

/**
 * Small HTTP helpers shared by route handlers.
 */

/** Best-effort client IP, masked for storage (never persisted in full). */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return headers.get("x-real-ip") ?? null;
}

export function getMaskedClientIp(headers: Headers): string | null {
  return maskIp(getClientIp(headers));
}

/** Rate-limit key that does not store a full IP address. */
export function rateLimitSubject(headers: Headers): string {
  const ip = getClientIp(headers);
  if (!ip) return "unknown";
  return maskIp(ip) ?? "unknown";
}

/** Safe JSON body parse — rejects non-object bodies. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Expected application/json");
  }
  return request.json();
}

/**
 * Basic same-origin check for state-changing requests (CSRF defense in depth on
 * top of SameSite=Lax cookies).
 *
 * The Origin host is compared against both `Host` and `X-Forwarded-Host` because
 * the app is served behind a proxy on Vercel and in preview environments.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from the app itself may omit it

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const candidates = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return false;
  return candidates.includes(originHost);
}
