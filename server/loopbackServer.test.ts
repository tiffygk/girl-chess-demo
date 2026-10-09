// The flaky "Parse Error: Expected HTTP/" in server/resume.test.ts
// (2026-10-08): supertest's request(app) calls app.listen(0), which binds
// the IPv6 wildcard "::", then connects to 127.0.0.1:<port>. macOS lets
// another process bind 127.0.0.1 on that same port, and the more specific
// bind wins, so the request reaches the other program. startLoopback binds
// 127.0.0.1 exactly, which no other process can then take.
import { describe, it, expect } from "vitest";
import http from "http";
import net from "net";
import { startLoopback } from "./loopbackServer";

function tryBind(port: number): Promise<string> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve("bound")));
  });
}

describe("startLoopback", () => {
  it("binds 127.0.0.1 exactly and is listening when it resolves", async () => {
    const server = await startLoopback((_q, r) => r.end("ok"));
    const addr = server.address() as net.AddressInfo;
    expect(addr.address).toBe("127.0.0.1");
    expect(addr.port).toBeGreaterThan(0);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("a second 127.0.0.1 bind on its port is refused, so no other program can take the requests", async () => {
    const server = await startLoopback((_q, r) => r.end("ok"));
    const { port } = server.address() as net.AddressInfo;
    expect(await tryBind(port)).toBe("EADDRINUSE");
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("supertest's own default (listen(0) on the wildcard) does let a 127.0.0.1 bind share the port", async () => {
    // The mechanism behind the flake, pinned so a Node or macOS change that
    // closes it shows up here rather than silently.
    const wild = http.createServer().listen(0);
    await new Promise<void>((r) => wild.once("listening", () => r()));
    const { port } = wild.address() as net.AddressInfo;
    expect(await tryBind(port)).toBe("bound");
    await new Promise<void>((r) => wild.close(() => r()));
  });
});

describe("every supertest call goes through a loopback server", () => {
  it("no file that imports supertest calls request(...) on anything but a startLoopback server", async () => {
    const { execFileSync } = await import("child_process");
    const fs = await import("fs");
    const files = execFileSync("git", ["ls-files", "server", "tools", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && fs.existsSync(f));
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      if (!/from "supertest"/.test(text)) continue;
      for (const m of text.matchAll(/\brequest\(([^)]*)\)/g)) {
        if (m[1] !== "api" && !/^await api\(/.test(m[1])) offenders.push(`${f}: request(${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
