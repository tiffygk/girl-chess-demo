import { afterEach, describe, expect, it, vi } from "vitest";
import { logHint } from "./api";

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
