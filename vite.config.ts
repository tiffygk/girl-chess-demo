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
  // Task 1f (coach-truth-speed latency round, 2026-08-02): `vite preview`
  // serves the BUILT static dist/ (no watcher, no HMR -- the whole point of
  // the built-server playtest launcher) but does NOT fall back to the
  // `server` block's own proxy -- it reads its own `preview` key. Same env
  // var, same default-to-her-live-port fallback, so this is additive and
  // changes nothing about `npm run dev`'s existing `vite` (server-key) path.
  preview: {
    port: Number(process.env.VITE_PREVIEW_PORT) || 4173,
    proxy: { "/api": process.env.VITE_API_TARGET || "http://localhost:3001" },
  },
  test: {
    // The css source pins (endCopy.test.ts) need the real stylesheet text.
    // With `css` unset vitest stubs EVERY .css import to an empty string --
    // even `?raw` -- which silently turns a source-pin regex into a match
    // against "". css: true makes `?raw` return the actual file contents.
    css: true,
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
      // 2026-07-28: three more worktrees (wt-forward, wt-highlight,
      // wt-missedwin) were created by parallel round windows during a single
      // session, and the gate silently went from 1007 tests to 4140 by globbing
      // into all of them. Naming worktrees one at a time loses that race every
      // time, so this is a PATTERN, not another literal: any sibling `wt-*`
      // directory is some other branch's tree, never this one's. Keep new
      // worktrees on the `wt-` prefix and the gate stays honest by itself.
      "**/wt-*/**",
    ],
  },
});
