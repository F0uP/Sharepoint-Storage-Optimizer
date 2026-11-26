import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// set from the release tag in CI – cached scans are dropped when it changes (src/lib/cache-version.ts)
const { version } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  // self-contained server bundle for the Docker image
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  env: { APP_VERSION: version },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
