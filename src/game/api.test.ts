import { afterEach, describe, expect, it, vi } from "vitest";
import { logHint, deleteGame, modeTimer, newSession, ServerUnreachableError } from "./api";

// Wave 0, item 1 (F0): hint telemetry was logging the OPPONENT's refutation
// move under the field named `bestUci` for levels 1-3 -- any log analysis
// trusting the field name concluded the coach recommended illegal moves.
// This pins the honest shape: levels 1-3 (nudge/warning escalation, before
// the deep search) carry the move under `refutationUci`; levels 4-5 (the
// verified deep hint) carry it under `bestUci`. The wire body may carry
// either key -- it must never mislabel one as the other.
describe("logHint (F0): the logged move is keyed honestly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(): { body: () => unknown } {
    let sentBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(init!.body as string);
        return { json: async () => ({ ok: true }) } as Response;
      })
    );
    return { body: () => sentBody };
  }

  it("a level 1-3 escalation logs the threat's refutation move under refutationUci, never bestUci", async () => {
    const { body } = stubFetch();
    await logHint(1, 2, "warning", 220, { refutationUci: "e7e5" }, "startfen");
    expect(body()).toEqual({
      level: 2,
      tier: "warning",
      deltaCp: 220,
      refutationUci: "e7e5",
      fen: "startfen",
    });
    expect(Object.keys(body() as object)).not.toContain("bestUci");
  });

  it("a level 4-5 climb logs the coach's actual best move under bestUci, never refutationUci", async () => {
    const { body } = stubFetch();
    await logHint(1, 5, "warning", 220, { bestUci: "g1f3" }, "startfen");
    expect(body()).toEqual({
      level: 5,
      tier: "warning",
      deltaCp: 220,
      bestUci: "g1f3",
      fen: "startfen",
    });
    expect(Object.keys(body() as object)).not.toContain("refutationUci");
  });
});

// Wave 2 (item 2, telemetry continuity): the detail JSON gains `branch` so a
// right-P2 opponent-threat reveal and a wrong-P2 best-piece reveal -- both at
// press 2, both keyed refutationUci/bestUci -- are distinguishable in the
// Lab. Sent from every press log; omitted on the branch-less level-0
// invalid-hint log.
describe("logHint (Wave 2): the press's branch travels on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(): { body: () => unknown } {
    let sentBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(init!.body as string);
        return { json: async () => ({ ok: true }) } as Response;
      })
    );
    return { body: () => sentBody };
  }

  it("a right-branch press carries branch:'right' alongside the honest move key", async () => {
    const { body } = stubFetch();
    await logHint(1, 2, "warning", 220, { refutationUci: "e7e5" }, "startfen", "right");
    expect(body()).toEqual({
      level: 2,
      tier: "warning",
      deltaCp: 220,
      refutationUci: "e7e5",
      fen: "startfen",
      branch: "right",
    });
  });

  it("a wrong-branch press carries branch:'wrong' (distinct from the right-branch press at the same press number)", async () => {
    const { body } = stubFetch();
    await logHint(1, 2, "warning", 220, { bestUci: "c1g5" }, "startfen", "wrong");
    expect((body() as { branch?: string }).branch).toBe("wrong");
  });

  it("omits branch when none is supplied (the branch-less level-0 invalid-hint log)", async () => {
    const { body } = stubFetch();
    await logHint(1, 0, "invalid", null, { bestUci: "none" }, "startfen");
    expect(Object.keys(body() as object)).not.toContain("branch");
  });
});

// Wave 3.5, item 2 (owner ask, 2026-08-01): deleteGame is the first non-POST
// write helper in this file -- pins that it actually issues a DELETE (not a
// GET/POST) against the right URL, with no body, and passes the server's
// envelope straight through.
describe("deleteGame (Wave 3.5, item 2): issues a real DELETE, no body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /api/game/:id and returns the server's envelope untouched", async () => {
    let seenUrl: string | undefined;
    let seenInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seenUrl = url;
        seenInit = init;
        return { json: async () => ({ ok: false, reason: "live" }) } as Response;
      })
    );

    const res = await deleteGame(42);

    expect(seenUrl).toBe("/api/game/42");
    expect(seenInit?.method).toBe("DELETE");
    expect(seenInit?.body).toBeUndefined();
    expect(res).toEqual({ ok: false, reason: "live" });
  });
});

// Round 3 (session-gone recovery, owner ruling 2026-08-02): a stale tab's
// mode heartbeat against a dead session used to keep firing every 30s
// forever (each one swallowed by the existing `.catch(() => undefined)`),
// producing 1,925+ server-side FK-500s in one night with zero client-side
// signal. The server now answers a typed { ok:false, error:"session_gone" }
// 404 (server/index.ts); modeTimer must stop its own interval the FIRST
// time it sees that envelope and tell the caller exactly once, never retry.
describe("modeTimer (session-gone recovery)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stops after a session_gone response and fires onGone exactly once", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => ({ json: async () => ({ ok: false, error: "session_gone" }) } as Response)
    );
    vi.stubGlobal("fetch", fetchMock);

    const onGone = vi.fn();
    const stop = modeTimer(42, "game", onGone);

    await vi.advanceTimersByTimeAsync(30_000); // first heartbeat -> session_gone
    await vi.advanceTimersByTimeAsync(90_000); // three more intervals would have fired if not stopped

    expect(onGone).toHaveBeenCalledTimes(1);
    // No heartbeat spam: exactly one POST went out, then the timer cleared itself.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps posting normally and never calls onGone while the session is alive", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true }) } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const onGone = vi.fn();
    const stop = modeTimer(42, "game", onGone);

    await vi.advanceTimersByTimeAsync(90_000); // three intervals

    expect(onGone).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("api: the server is not running", () => {
  it("maps a fetch network failure to ServerUnreachableError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(newSession()).rejects.toBeInstanceOf(ServerUnreachableError);
    vi.unstubAllGlobals();
  });
  it("leaves other failures alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(newSession()).resolves.toBeDefined(); // today postJson returns the parsed body regardless of status; do not change that here
    vi.unstubAllGlobals();
  });
  // Discovered running the real runtime check for this task: under `vite`'s
  // dev proxy (server/vite.config.ts's `/api` proxy), a server that isn't
  // listening doesn't make fetch() itself throw -- the browser's fetch
  // resolves fine against Vite's own dev server, which answers with its own
  // 502 Bad Gateway and a plain-text (non-JSON) body. res.json() then throws
  // a SyntaxError, which propagated as an unhandled, unrecognized rejection
  // and left the page on the "could not reach the game server" fallback
  // instead of the intended ServerDownNotice. This is the same underlying
  // fact (nothing is listening) surfacing one layer later.
  it("maps an unparseable-JSON response (a dev-proxy 502 with a plain-text body) to ServerUnreachableError too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad Gateway", { status: 502 })));
    await expect(newSession()).rejects.toBeInstanceOf(ServerUnreachableError);
    vi.unstubAllGlobals();
  });
});
