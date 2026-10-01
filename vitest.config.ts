import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests cover the **pure money logic** — the calculations that decide what
 * a customer owes, what a schedule looks like, and who is allowed to change
 * either. Those modules deliberately avoid importing Prisma so they can be
 * tested exactly like this (see the header comments in lib/installments.ts and
 * lib/invoice-settlement.ts).
 *
 * Node environment, no jsdom: nothing here renders. `@/` is aliased by hand
 * rather than through a tsconfig-paths plugin to keep the dev dependency count
 * to one.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
