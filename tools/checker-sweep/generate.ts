// tools/checker-sweep/generate.ts
//
// 2a follow-up round (2026-09-22): the claim generator and labeller for the
// checker sweep over stored chat fact lists. Deliberately imports chess.js
// and plain types only -- NOTHING from server/coach/ (grep-checked by the
// controller; see brief-2a.md and plan.md 2a / gate-review.md finding B1).
// run.ts is the file that imports validateChat/validateChatGeneral and
// routes these claims through them; this file only produces claim text and
// an independently-computed label.
//
// Label spec (gate-review.md B1's fix, written to
// results/2a-scope-table.md before this file existed): a claim is TRUE if
// chess.js finds it true on the live board, the focused board, or any board
// within the first K plies of a line the stored fact list carries -- K = 4
// for placement's hint/turning-point lines, 2 for placement's candidate
// line and every relation line, 1 for the pending move. This file
// replicates chat.ts's lineOccupancies/lineFens board-selection logic
// independently (same per-source horizons, own chess.js replay) rather than
// importing those functions, per B1.
import { Chess } from "chess.js";

export interface OccEntry {
  square: string;
  pieceKind: string; // p/n/b/r/q/k
  color: "you" | "mallow";
}

// The slice of a stored ChatFactList's JSON shape this file reads. Defined
// locally (not imported) so this file never depends on server/coach/chat.ts's
// types.
export interface StoredFactsShape {
  currentFen: string;
  occupancy: OccEntry[];
  focusPosition?: { fen: string; occupancy: OccEntry[] };
  hintFindings?: { fen: string; pvSans: string[] };
  context?: {
    hintFocus?: { pvSans?: string[] };
    turningPointFocus?: { pvSans?: string[] };
    pendingMove?: { san?: string };
  };
  candidateLine?: { san: string; replySan?: string };
}

type Depth = "live" | "focus" | number; // number = plies into a line, 1-based

interface TaggedBoard {
  fen: string;
  depth: Depth;
  source: string; // "live" | "focus" | "hint" | "turning-point" | "candidate" | "pending"
}

function replayLine(fen: string, sans: string[], maxPlies: number, source: string): TaggedBoard[] {
  const out: TaggedBoard[] = [];
  const c = new Chess(fen);
  for (let i = 0; i < Math.min(sans.length, maxPlies); i++) {
    try {
      c.move(sans[i]);
    } catch {
      break;
    }
    out.push({ fen: c.fen(), depth: i + 1, source });
  }
  return out;
}

// Placement board set: mirrors chat.ts's lineOccupancies (K=4 hint/tp, K=2
// candidate, K=1 pending).
export function placementBoards(f: StoredFactsShape): TaggedBoard[] {
  const boards: TaggedBoard[] = [{ fen: f.currentFen, depth: "live", source: "live" }];
  if (f.focusPosition) boards.push({ fen: f.focusPosition.fen, depth: "focus", source: "focus" });
  const hint = f.hintFindings?.pvSans ?? f.context?.hintFocus?.pvSans;
  if (hint?.length) boards.push(...replayLine(f.currentFen, hint, 4, "hint"));
  const tp = f.context?.turningPointFocus?.pvSans;
  if (tp?.length && f.focusPosition) boards.push(...replayLine(f.focusPosition.fen, tp, 4, "turning-point"));
  if (f.candidateLine) {
    const sans = [f.candidateLine.san, ...(f.candidateLine.replySan ? [f.candidateLine.replySan] : [])];
    boards.push(...replayLine(f.currentFen, sans, 2, "candidate"));
  }
  const pending = f.context?.pendingMove?.san;
  if (pending) boards.push(...replayLine(f.currentFen, [pending], 1, "pending"));
  return boards;
}

// Relation board set: mirrors chat.ts's lineFens (K=2 hint/tp/candidate,
// K=1 pending -- fixed to 2 for the relation family per trace 361, see
// chat.ts's lineFens comment and results/2a-scope-table.md).
export function relationBoards(f: StoredFactsShape): TaggedBoard[] {
  const boards: TaggedBoard[] = [{ fen: f.currentFen, depth: "live", source: "live" }];
  if (f.focusPosition) boards.push({ fen: f.focusPosition.fen, depth: "focus", source: "focus" });
  const hint = f.hintFindings?.pvSans ?? f.context?.hintFocus?.pvSans;
  if (hint?.length) boards.push(...replayLine(f.currentFen, hint, 2, "hint"));
  const tp = f.context?.turningPointFocus?.pvSans;
  if (tp?.length && f.focusPosition) boards.push(...replayLine(f.focusPosition.fen, tp, 2, "turning-point"));
  if (f.candidateLine) {
    const sans = [f.candidateLine.san, ...(f.candidateLine.replySan ? [f.candidateLine.replySan] : [])];
    boards.push(...replayLine(f.currentFen, sans, 2, "candidate"));
  }
  const pending = f.context?.pendingMove?.san;
  if (pending) boards.push(...replayLine(f.currentFen, [pending], 1, "pending"));
  return boards;
}

const KIND_WORD: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
const ALL_KINDS = Object.keys(KIND_WORD);

function occupancyFromFen(fen: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const c = new Chess(fen);
    for (const row of c.board()) {
      for (const cell of row) {
        if (cell) map.set(cell.square, cell.type);
      }
    }
  } catch {
    // unparseable fen -- empty board, no claim can be adjudicated true here
  }
  return map;
}

export interface PlacementClaim {
  text: string;
  claimKey: string;
  kind: "sanity-true" | "adversarial";
  label: boolean;
  trueOnLive: boolean;
  trueOnFocus: boolean | null;
  trueOnLineDepth: number | null; // shallowest depth 1..4 at which true, else null
  leniency: boolean; // label true, but only via a line board at depth 3 or 4
}

// Up to `squareCap` squares of interest per fact list: live-occupied
// squares first (sanity claims need something there), then squares whose
// occupant differs between the live board and the deepest available line
// board (these are the squares likeliest to expose a leniency/over-widening
// bug, since they are exactly where "true later, false now" claims occur).
function interestingSquares(boards: TaggedBoard[], squareCap: number): string[] {
  const live = occupancyFromFen(boards.find((b) => b.depth === "live")!.fen);
  const liveOccupied = [...live.keys()];
  const changed = new Set<string>();
  for (const b of boards) {
    if (b.depth === "live") continue;
    const occ = occupancyFromFen(b.fen);
    for (const [sq, kind] of occ) {
      if (live.get(sq) !== kind) changed.add(sq);
    }
    for (const sq of live.keys()) {
      if (!occ.has(sq)) changed.add(sq); // vacated on this board
    }
  }
  const ordered = [...liveOccupied, ...[...changed].filter((s) => !liveOccupied.includes(s))];
  return ordered.slice(0, squareCap);
}

export function generatePlacementClaims(
  boards: TaggedBoard[],
  squareCap = 12
): PlacementClaim[] {
  const live = occupancyFromFen(boards.find((b) => b.depth === "live")!.fen);
  const focusBoard = boards.find((b) => b.depth === "focus");
  const focusOcc = focusBoard ? occupancyFromFen(focusBoard.fen) : null;
  const lineBoardsByDepth = boards.filter(
    (b) => typeof b.depth === "number"
  ) as { fen: string; depth: number; source: string }[];

  const claims: PlacementClaim[] = [];
  for (const sq of interestingSquares(boards, squareCap)) {
    const liveKind = live.get(sq) ?? null;

    // Sanity-true claim: name the live occupant. Label is TRUE by
    // construction (true on the live board), so a checker flagging it as a
    // violation is a false alarm.
    if (liveKind) {
      claims.push({
        text: `the ${KIND_WORD[liveKind]} is on ${sq}`,
        claimKey: `${liveKind}>${sq}`,
        kind: "sanity-true",
        label: true,
        trueOnLive: true,
        trueOnFocus: focusOcc ? focusOcc.get(sq) === liveKind : null,
        trueOnLineDepth: null,
        leniency: false,
      });
    }

    // Adversarial claim: pick a kind that is NOT the live occupant. Prefer
    // a kind that appears at the deepest available line board for this
    // square (if any), since that is the shape most likely to expose
    // leniency (false live/focus, true only late in a line).
    const wrongKinds = ALL_KINDS.filter((k) => k !== liveKind);
    let chosenWrong = wrongKinds[0];
    let deepestMatchDepth: number | null = null;
    for (const wrong of wrongKinds) {
      let deepest: number | null = null;
      for (const lb of lineBoardsByDepth) {
        const occ = occupancyFromFen(lb.fen);
        if (occ.get(sq) === wrong) deepest = deepest === null ? lb.depth : Math.max(deepest, lb.depth);
      }
      if (deepest !== null && (deepestMatchDepth === null || deepest > deepestMatchDepth)) {
        deepestMatchDepth = deepest;
        chosenWrong = wrong;
      }
    }

    const trueOnFocusAdv = focusOcc ? focusOcc.get(sq) === chosenWrong : null;
    let trueOnLineDepth: number | null = null;
    for (const lb of lineBoardsByDepth) {
      const occ = occupancyFromFen(lb.fen);
      if (occ.get(sq) === chosenWrong) {
        trueOnLineDepth = trueOnLineDepth === null ? lb.depth : Math.min(trueOnLineDepth, lb.depth);
      }
    }
    const trueOnLiveAdv = liveKind === chosenWrong; // always false by construction
    const label = trueOnLiveAdv || !!trueOnFocusAdv || trueOnLineDepth !== null;
    const leniency = label && !trueOnLiveAdv && !trueOnFocusAdv && trueOnLineDepth !== null && trueOnLineDepth >= 3;

    claims.push({
      text: `the ${KIND_WORD[chosenWrong]} is on ${sq}`,
      claimKey: `${chosenWrong}>${sq}`,
      kind: "adversarial",
      label,
      trueOnLive: trueOnLiveAdv,
      trueOnFocus: trueOnFocusAdv,
      trueOnLineDepth,
      leniency,
    });
  }
  return claims;
}

export interface RelationClaim {
  text: string;
  claimKey: string;
  polarity: "positive" | "denial";
  label: boolean | null; // null => scored: false (unadjudicable on every board)
  scopeReason?: string;
  attackersLabel?: boolean; // positives only
  legalCaptureLabel?: boolean | null; // positives only; null if never adjudicable
  semanticCut?: boolean;
  paraphrases: string[];
}

// Whether square `a`'s occupant (on board `fen`) geometrically attacks
// square `b` -- same primitive relationClaims.ts's relationHolds uses.
function relationHoldsOnBoard(fen: string, a: string, b: string): boolean {
  try {
    const c = new Chess(fen);
    const piece = c.get(a as Parameters<typeof c.get>[0]);
    if (!piece) return false;
    return c
      .attackers(b as Parameters<Chess["attackers"]>[0], piece.color)
      .includes(a as never);
  } catch {
    return false;
  }
}

// Legal-capture adjudication for square `a` -> `b` on board `fen`. Returns
// null when this board cannot adjudicate (no piece at a, or a's occupant is
// not the side to move on this board) -- same discipline as
// relationClaims.ts's deniedCaptureHolds.
function legalCaptureOnBoard(fen: string, a: string, b: string): boolean | null {
  try {
    const c = new Chess(fen);
    const piece = c.get(a as Parameters<typeof c.get>[0]);
    if (!piece) return null;
    if (piece.color !== c.turn()) return null;
    return c.moves({ verbose: true }).some((mv) => mv.from === a && mv.to === b);
  } catch {
    return null;
  }
}

function fenOf(board: TaggedBoard): string {
  return board.fen;
}

export function generateRelationClaims(
  boards: TaggedBoard[],
  squareCap = 6
): RelationClaim[] {
  const liveBoard = boards.find((b) => b.depth === "live")!;
  const liveOcc = occupancyFromFen(liveBoard.fen);
  const liveColorMap = new Map<string, "you" | "mallow">();
  try {
    const c = new Chess(liveBoard.fen);
    for (const row of c.board()) {
      for (const cell of row) {
        if (cell) liveColorMap.set(cell.square, cell.color === "w" ? "you" : "mallow");
      }
    }
  } catch {
    // leave empty
  }
  const squares = [...liveOcc.keys()].slice(0, squareCap);
  const claims: RelationClaim[] = [];

  for (const a of squares) {
    const aKind = liveOcc.get(a)!;
    const aColor = liveColorMap.get(a) === "you" ? "w" : "b";
    for (const b of squares) {
      if (a === b) continue;

      // Geometric truth per the label spec: true if relationHolds on ANY
      // board (live, focus, line boards within the relation horizon).
      let attackersLabel = false;
      let deepestTrueDepth: number | null = null;
      for (const board of boards) {
        if (relationHoldsOnBoard(fenOf(board), a, b)) {
          attackersLabel = true;
          if (typeof board.depth === "number") {
            deepestTrueDepth = deepestTrueDepth === null ? board.depth : Math.min(deepestTrueDepth, board.depth);
          }
        }
      }

      if (attackersLabel) {
        // Positive claim: "<piece> on <a> attacks <b>". Double-labelled by
        // legal-capture existence per B1.
        let legalCaptureLabel: boolean | null = null;
        let adjudicated = false;
        for (const board of boards) {
          const lc = legalCaptureOnBoard(fenOf(board), a, b);
          if (lc !== null) {
            adjudicated = true;
            legalCaptureLabel = legalCaptureLabel === true ? true : lc;
          }
        }
        const semanticCut = adjudicated && legalCaptureLabel !== attackersLabel;
        const claimKey = `pos>${a}>${b}`;
        claims.push({
          text: `the ${KIND_WORD[aKind]} on ${a} attacks ${b}`,
          claimKey,
          polarity: "positive",
          label: true,
          attackersLabel,
          legalCaptureLabel: adjudicated ? legalCaptureLabel : null,
          semanticCut,
          paraphrases: [
            `the ${KIND_WORD[aKind]} on ${a} could capture the piece on ${b}`,
            `the ${KIND_WORD[aKind]} on ${a} is aiming at ${b}`,
            `the piece on ${b} can be taken by the ${KIND_WORD[aKind]} on ${a}`,
          ],
        });
      } else {
        // Denial claim: "<piece> on <a> can't reach <b>". Adjudicable only
        // on boards where a's occupant is the side to move there.
        let adjudicated = false;
        let anyBoardTrue = false; // "true" for a denial = no legal capture exists
        for (const board of boards) {
          const lc = legalCaptureOnBoard(fenOf(board), a, b);
          if (lc === null) continue;
          adjudicated = true;
          if (!lc) anyBoardTrue = true;
        }
        if (!adjudicated) {
          claims.push({
            text: `the ${KIND_WORD[aKind]} on ${a} can't reach ${b}`,
            claimKey: `den>${a}>${b}`,
            polarity: "denial",
            label: null,
            scopeReason: "non-mover denial (relationClaims.ts:110,:136): unadjudicable on every board offered",
            paraphrases: [
              `the ${KIND_WORD[aKind]} on ${a} could capture the piece on ${b}`,
              `the ${KIND_WORD[aKind]} on ${a} is aiming at ${b}`,
              `the piece on ${b} can be taken by the ${KIND_WORD[aKind]} on ${a}`,
            ],
          });
          continue;
        }
        claims.push({
          text: `the ${KIND_WORD[aKind]} on ${a} can't reach ${b}`,
          claimKey: `den>${a}>${b}`,
          polarity: "denial",
          label: anyBoardTrue,
          paraphrases: [
            `the ${KIND_WORD[aKind]} on ${a} could capture the piece on ${b}`,
            `the ${KIND_WORD[aKind]} on ${a} is aiming at ${b}`,
            `the piece on ${b} can be taken by the ${KIND_WORD[aKind]} on ${a}`,
          ],
        });
      }
    }
  }
  return claims;
}

// Today's-board control claims (M3/B1): true-by-construction claims about a
// single finished-game position, using the same two grammars, for the
// separate control family. Never a violation on any SHA since the live
// board is always in the board set every version of these checkers has had.
export function generateControlClaims(fen: string): { placement: PlacementClaim[]; relation: RelationClaim[] } {
  const occ = occupancyFromFen(fen);
  const placement: PlacementClaim[] = [];
  for (const [sq, kind] of occ) {
    placement.push({
      text: `the ${KIND_WORD[kind]} is on ${sq}`,
      claimKey: `${kind}>${sq}`,
      kind: "sanity-true",
      label: true,
      trueOnLive: true,
      trueOnFocus: null,
      trueOnLineDepth: null,
      leniency: false,
    });
  }
  const relation: RelationClaim[] = [];
  const squares = [...occ.keys()];
  outer: for (const a of squares) {
    for (const b of squares) {
      if (a === b) continue;
      if (relationHoldsOnBoard(fen, a, b)) {
        relation.push({
          text: `the ${KIND_WORD[occ.get(a)!]} on ${a} attacks ${b}`,
          claimKey: `pos>${a}>${b}`,
          polarity: "positive",
          label: true,
          paraphrases: [],
        });
        break outer; // one true-by-construction relation claim is enough for the control
      }
    }
  }
  return { placement: placement.slice(0, 4), relation };
}
