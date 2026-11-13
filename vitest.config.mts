import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": r("./src"),
      // the real package throws outside of React Server Components
      "server-only": r("./tests/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "desktop/**/*.test.mts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    // jsdom + coverage instrumentation is slow on CI runners
    testTimeout: 30_000,
    unstubEnvs: true,
    unstubGlobals: true,
    // jsdom workers are memory-hungry and must start within 60 s – two are as fast locally and stable
    maxWorkers: process.env.CI ? undefined : 2,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**", "src/components/file-table.tsx"],
      exclude: ["src/lib/graph.ts", "src/lib/msal.ts"],
      reporter: ["text-summary", "html", "lcov"],
    },
  },
});
