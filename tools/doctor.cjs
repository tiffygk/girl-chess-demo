// npm run doctor lands here first. npm echoes the script line it runs, so
// this file keeps that line short and does the one check that must happen
// before tsx exists: has npm ci run? Then it hands off to tools/doctor.ts.
const { existsSync } = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");
if (!existsSync(tsx)) {
  console.log("run npm ci first, then npm run doctor.");
  process.exit(1);
}
const r = spawnSync(tsx, [path.join(root, "tools", "doctor.ts")], { stdio: "inherit", cwd: root, env: process.env });
process.exit(r.status == null ? 1 : r.status);
