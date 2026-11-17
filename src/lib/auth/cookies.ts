import { cookies } from "next/headers";
import { getServerEnv, isProduction } from "@/config/env";

/**
 * Session cookie helpers. Only callable from Route Handlers, Server Actions or
 * Server Components (Next.js `cookies()` is not available in client code).
 */

export function getSessionCookieName(): string {
  return getServerEnv().AUTH_COOKIE_NAME;
}

function cookieOptions(maxAgeSeconds: number) {
  // Secure by default in production; explicit override for plain-HTTP setups.
  const secure = getServerEnv().AUTH_COOKIE_SECURE ?? isProduction();
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  const maxAge = Math.max(
    60,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  store.set(getSessionCookieName(), token, cookieOptions(maxAge));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(getSessionCookieName(), "", cookieOptions(0));
}

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(getSessionCookieName())?.value;
}
