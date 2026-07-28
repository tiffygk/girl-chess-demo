// defineConfig comes from "vitest/config", not "vite" -- the vite one has no
// `test` key in its type, so adding the exclude list below fails tsc.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: { "/api": process.env.VITE_API_TARGET || "http://localhost:3001" },
  },
  test: {
    // Owner reorg 2026-07-28 moved the repo into the vault and nested the two
    // agent worktrees INSIDE it. Without these excludes vitest globs into them
    // and runs old branches' suites too -- 996 tests became 2555, with 2
    // failures that belong to a stale branch rather than to this one. Excluding
    // them here (not just via a --exclude flag) keeps every gate run honest
    // without anyone having to remember the flags.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/**",
      "**/girl-chess-eval3/**",
      "**/girl-chess-r2/**",
    ],
  },
});
