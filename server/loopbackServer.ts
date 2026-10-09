// Test-only helper: an HTTP server bound to 127.0.0.1 exactly, resolved once
// it is listening, for supertest's request(server). supertest's own
// request(app) binds the IPv6 wildcard and connects to 127.0.0.1, and on
// macOS another program can bind 127.0.0.1 on the same port and receive the
// request (loopbackServer.test.ts pins both halves).
import http from "http";

export function startLoopback(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
