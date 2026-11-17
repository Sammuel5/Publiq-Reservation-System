import { OAuth2Client } from "google-auth-library";

export function customerGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const sessionSecret = process.env.CUSTOMER_SESSION_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32 || !redirectUri) return null;
  try {
    const uri = new URL(redirectUri);
    const local = uri.hostname === "localhost" || uri.hostname === "127.0.0.1";
    if ((!local && uri.protocol !== "https:") || (local && !["http:", "https:"].includes(uri.protocol)) || uri.pathname !== "/api/customer-auth/google/callback" || uri.search || uri.hash || uri.username || uri.password) return null;
    return { clientId, clientSecret, sessionSecret, redirectUri, secure: uri.protocol === "https:", oauth: new OAuth2Client(clientId, clientSecret, redirectUri) };
  } catch { return null; }
}
