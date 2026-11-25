import type { NextConfig } from "next";

/**
 * The browser talks only to this app's origin: /api/v1/* is proxied to the API (API_URL), so no CORS and the
 * step-up action hash sees the same path. Default: the API on localhost:3000.
 */
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tp/ui", "@tp/client"],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default config;
