// B2.1/B2.3 (live-telemetry round, 2026-09-22): proves DATA_GC agrees with
// B1's manifest AND that every stamped attribute carries the value the
// component actually rendered with, not a recomputation or a constant.
// Node-env, react-dom/server only (CoachChat.test.tsx/DebriefPage.test.tsx's
// established precedent) -- no jsdom, no DOM needed. GamePage.tsx's own
// wiring is covered separately in dataGc.gamepage.test.tsx (it reads
// window.localStorage during its very first render, so it needs jsdom --
// see that file's header for why it lives apart from this one).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DATA_GC } from "./dataGc";
import { AGENT_MANIFEST } from "../../server/agentManifest";
import { Board } from "../board/Board";
import { CoachChat } from "../game/CoachChat";
import type { ChatContext } from "../game/api";
import { DebriefPage, type DebriefPageProps } from "../review/DebriefPage";
import type { TurningPoint, TurningLine, SummaryMove } from "../game/api";

function noop() {
  /* no-op callback -- none of these components invoke callbacks during a static render */
}

describe("DATA_GC two-way agreement with server/agentManifest.ts (B1's canonical declaration)", () => {
  it("has exactly the same attribute names as AGENT_MANIFEST.dataGcAttributes", () => {
    // RED condition: rename or drop a key in DATA_GC (or in the manifest)
    // without updating the other side -- this sort/compare catches it
    // regardless of declaration order on either side.
    const fromMap = Object.values(DATA_GC).slice().sort();
    const fromManifest = AGENT_MANIFEST.dataGcAttributes.slice().sort();
    expect(fromMap).toEqual(fromManifest);
  });
});

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("Board.tsx: data-gc-* attributes read from the same fen/turn/pending/arrows the board renders", () => {
  it("stamps fen and side (derived the same way `turn` is) on the board-inner container", () => {
    const html = renderToStaticMarkup(<Board fen={BLACK_TO_MOVE_FEN} onMove={noop} />);
    expect(html).toContain(`${DATA_GC.fen}="${BLACK_TO_MOVE_FEN}"`);
    expect(html).toContain(`${DATA_GC.side}="b"`);
  });

  it("stamps an empty data-gc-pending when no move is pending, and the from-to pair when one is", () => {
    const idle = renderToStaticMarkup(<Board fen={START_FEN} onMove={noop} pending={null} />);
    expect(idle).toContain(`${DATA_GC.pending}=""`);

    const pending = renderToStaticMarkup(
      <Board fen={START_FEN} onMove={noop} pending={{ from: "e2", to: "e4" }} />,
    );
    expect(pending).toContain(`${DATA_GC.pending}="e2-e4"`);
  });

  it("stamps data-gc-arrows on the svg from the SAME arrows array being drawn", () => {
    const html = renderToStaticMarkup(
      <Board
        fen={START_FEN}
        onMove={noop}
        arrows={[
          { from: "e2", to: "e4", color: "played" },
          { from: "e7", to: "e5", color: "best" },
        ]}
      />,
    );
    expect(html).toContain(`${DATA_GC.arrows}="e2-e4;e7-e5"`);
  });
});

describe("CoachChat.tsx: data-gc-trace-id distinguishes messages the same visible text can't", () => {
  // Content-key trap (required by B2.3): two coach messages render the
  // IDENTICAL bubble text ("nice tactic!") but come from different traces.
  // A stub that hardcoded the attribute (or derived it from the text) would
  // make this fail; reading m.traceId is what keeps it green.
  it("gives two coach messages with the same text different data-gc-trace-id values", () => {
    const buildContext = (): ChatContext => ({ mode: "live" });
    const htmlA = renderToStaticMarkup(
      <CoachChat
        gameId={1}
        mode="live"
        buildContext={buildContext}
        hidden={false}
        backendPref="agent-sdk"
        history={[{ role: "coach", text: "nice tactic!", createdAt: "2026-09-22T00:00:00Z", traceId: 101 }]}
      />,
    );
    const htmlB = renderToStaticMarkup(
      <CoachChat
        gameId={1}
        mode="live"
        buildContext={buildContext}
        hidden={false}
        backendPref="agent-sdk"
        history={[{ role: "coach", text: "nice tactic!", createdAt: "2026-09-22T00:00:00Z", traceId: 202 }]}
      />,
    );
    expect(htmlA).toContain("nice tactic!");
    expect(htmlB).toContain("nice tactic!");
    expect(htmlA).toContain(`${DATA_GC.traceId}="101"`);
    expect(htmlB).toContain(`${DATA_GC.traceId}="202"`);
    expect(htmlA).not.toContain(`${DATA_GC.traceId}="202"`);
  });

  it("stamps an empty data-gc-trace-id when a message carries no trace", () => {
    const buildContext = (): ChatContext => ({ mode: "live" });
    const html = renderToStaticMarkup(
      <CoachChat
        gameId={1}
        mode="live"
        buildContext={buildContext}
        hidden={false}
        backendPref="agent-sdk"
        history={[{ role: "user", text: "why?", createdAt: "2026-09-22T00:00:00Z" }]}
      />,
    );
    expect(html).toContain(`${DATA_GC.traceId}=""`);
  });
});

const A_TURNING_POINT: TurningPoint = {
  rank: 1,
  ply: 3,
  san: "Qh5",
  label: "blunder",
  deltaP: -0.1,
  lowConfidence: false,
  kind: "swing",
};
const A_LINE: TurningLine = { ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" };
const SANS: SummaryMove[] = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
  { ply: 3, san: "Qh5" },
];

function debriefBaseProps(overrides: Partial<DebriefPageProps> = {}): DebriefPageProps {
  return {
    turningPoints: [],
    classifications: [],
    turningLines: [],
    gameSans: SANS,
    totalPlies: 3,
    result: null,
    rewindPly: null,
    onRewind: noop,
    onBackToEnd: noop,
    onOpenPastGames: noop,
    exploring: null,
    onTryLine: noop,
    onExitExplore: noop,
    onAskAboutTurningPoint: noop,
    onAskAboutPly: noop,
    ...overrides,
  };
}

describe("DebriefPage.tsx: data-gc-turning-count reads orderedPoints.length, the same length the cards render from", () => {
  it("omits the debrief-cards container (and the attribute with it) when there are no turning points", () => {
    const html = renderToStaticMarkup(<DebriefPage {...debriefBaseProps()} />);
    expect(html).not.toContain("debrief-cards");
    expect(html).not.toContain(DATA_GC.turningCount);
  });

  it("stamps the real count, not a constant, when turning points render", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...debriefBaseProps({ turningPoints: [A_TURNING_POINT], turningLines: [A_LINE] })} />,
    );
    expect(html).toContain(`${DATA_GC.turningCount}="1"`);
  });
});
