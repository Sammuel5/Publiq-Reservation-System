import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware — first line of defense for /admin/*.
 *
 * It only checks that a session cookie is PRESENT: verifying the token requires
 * a database round-trip, which belongs on the server (the admin layout and every
 * admin API route validate the session against MongoDB). This keeps middleware
 * fast, avoids exposing a signing key to the edge, and still gives unauthenticated
 * visitors an instant redirect instead of a flash of protected markup.
 */

const SESSION_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "ktv_admin_session";
const LOGIN_PATH = "/admin/login";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasSessionCookie) {
    // Old screens operate on unrelated room inventory; never present them as
    // authoritative seating availability. The destination still verifies auth.
    if (/^\/admin\/(?:calendar|rooms|blocks|payments|customers)(?:\/|$)/.test(pathname) || /^\/admin\/reservations\/.+/.test(pathname) || pathname === "/admin/seating-bookings") {
      return NextResponse.redirect(new URL("/admin/reservations", request.url));
    }
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;

  const response = NextResponse.redirect(loginUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
