import type { NextConfig } from "next";

const API = process.env.API_URL ?? "http://localhost:4000";

// The browser talks to the API through Next so the session cookie is first-party.
const config: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/auth/:path*", destination: `${API}/auth/:path*` },
    ];
  },
};

export default config;
