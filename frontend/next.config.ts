import type { NextConfig } from "next";

// APP_MODE=runtime builds the standalone inspection app: operator pages plus the runtime API proxy only.
const runtimeMode = process.env.APP_MODE === "runtime";
const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:8000";

const config: NextConfig = {
  output: "standalone",
  env: { APP_MODE: runtimeMode ? "runtime" : "studio" },
  async rewrites() {
    return [
      runtimeMode
        ? { source: "/api/runtime/:path*", destination: `${api}/api/runtime/:path*` }
        : { source: "/api/:path*", destination: `${api}/api/:path*` },
    ];
  },
};
export default config;
