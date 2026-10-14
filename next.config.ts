import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone: a self-contained server with only the traced
  // production dependencies. The production Docker image runs this output.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Development only. The dev URL is http://127.0.0.1:3000 (see `make urls`);
  // without this the dev server refuses that host its hot-reload channel, and
  // pages opened there never become interactive. *.localhost covers the tenant
  // subdomains in development (PLATFORM_BASE_DOMAIN=localhost).
  allowedDevOrigins: ["127.0.0.1", "*.localhost"],

  experimental: {
    serverActions: {
      // The tenant forms upload a profile image of up to 2 MB together with
      // their fields; the default limit is 1 MB.
      bodySizeLimit: "3mb",
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
