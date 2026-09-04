import type { Request, Response, NextFunction } from "express";

// Security round 2026-09-04, audit finding 2. The API has no auth by design
// (single-user, local). A page on another site cannot read our responses
// without CORS headers, but a cross-site <form method=POST> reaches the
// body-less routes (resign, draw-offer, hint-facts) with no preflight. Any
// request that carries an Origin header must carry a loopback one. Requests
// with no Origin (same-origin GETs, curl, the Vite proxy's own probes) pass.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(hostname);
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (isLocalOrigin(req.headers.origin)) return next();
  res.status(403).json({ ok: false, error: "forbidden_origin" });
}
