import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/cloudflare-env.ts", import.meta.url),
      ),
      "emdash-test-cron": fileURLToPath(
        new URL("./node_modules/emdash/src/plugins/cron.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 30000,
    server: { deps: { inline: ["@emdash-cms/cloudflare"] } },
  },
});
