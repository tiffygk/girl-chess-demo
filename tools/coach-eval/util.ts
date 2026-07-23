// tools/coach-eval/util.ts -- tiny shared helpers for run.ts and render.ts.
// Deliberately dependency-free beyond node builtins.
import crypto from "crypto";
import fs from "fs";

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// e.g. "20260722T233015Z" -- filesystem-safe, sortable, second precision
// (strips ":" and "." from the ISO string, then drops the millisecond
// digits before re-appending the "Z").
export function timestamp(): string {
  const stripped = new Date().toISOString().replace(/[:.]/g, "");
  return `${stripped.slice(0, 15)}Z`;
}
