import type { NextConfig } from "next";

// Opt in to ONE known tunnel hostname for the development server only.
// This setting is not authentication and must never be a wildcard.
const devHost = process.env.NEXT_DEV_ALLOWED_HOST?.trim();
if (devHost && !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(devHost)) {
  throw new Error("NEXT_DEV_ALLOWED_HOST must be a hostname only, without https://, a port, path, or wildcard.");
}

const nextConfig: NextConfig = {
  ...(devHost ? { allowedDevOrigins: [devHost] } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["mongoose", "bcryptjs"],
  images: {
    // Room/hero photography is served from external hosting (see Phase 3 room management).
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "utfs.io" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Admin surfaces must never be indexed or cached by shared proxies.
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
