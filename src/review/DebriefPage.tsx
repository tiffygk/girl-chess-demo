// Increment 3c: the debrief under the game (UX research: lead with curated
// turning points incl. a positive when real; name the KIND of mistake; one
// visual cluster for coach text + board + rewind, never scattered focal
// points; saving is inline and organized by lesson, not raw game id; no
// data-dump — see "Post-Game Review UX Research.md" for the full argument).
//
// Three pieces live in this one file (brief left the split to the builder's
// judgement when a separate component would be artificial):
//   - DebriefPage: the structured bullet set (debrief-v2, replacing the
//     single lesson sentence — see debriefBullets.ts) + turning-point cards
//     + rewind controls, rendered both under a just-finished live game
//     (inside GameEndPanel) and under a reviewed past game (REVIEW MODE).
//   - PastGamesButton: the small trigger, reused verbatim at its two
//     required call sites (pregame panel, live debrief).
//   - PastGamesDrawer: the "file it away" saved-games list, organized by
//     each game's rank-1 turning point (its "lesson" tag) per UX lesson 5.
//
// deltaP is deliberately never rendered anywhere in this file — "the story
// is words, not numbers" (brief).

import type { GameListEntry, MoveClassification, TurningPoint, TurningLine } from "../game/api";
import { moveNumberForPly } from "./debriefLesson";
import { debriefBullets, type DebriefBullet } from "./debriefBullets";
// Increment 3.91 (Task 4): the four-part note, rendered under a turning-
// point card once its own "replay" has been clicked (see `active` below).
// Pure/deterministic module — see turningPointNote.ts's header for why it
// deliberately doesn't import from debriefBullets.ts.
import { buildTurningPointNote } from "./turningPointNote";

// Her own negative move labels — same set debriefLesson.ts uses to find her
// worst point, reused here to decide which cards get the magenta tint.
// "the losing move" (an opponent-side backfill point naming the moment she
// was already lost) is negative in outcome even though she didn't play it,
// so it gets the same tint; every other label (opponent errors, checkmate,
// the clincher, strong move) stays the lavender default.
const NEGATIVE_CARD_LABELS = new Set(["blunder", "mistake", "inaccuracy", "the losing move"]);

function resultWord(result: string): string {
  if (result === "1-0") return "won";
  if (result === "0-1") return "lost";
  return "draw";
}

// "maia-1400" / "fallback-1400" -> "1400". Falls back to the raw string on
// anything unrecognized rather than showing nothing.
function eloFromOpponent(opponent: string): string {
  const m = opponent.match(/(\d+)\s*$/);
  return m ? m[1] : opponent;
}

interface TurningPointCardProps {
  point: TurningPoint;
  onRewind: (ply: number) => void;
  // Increment 3.91 (Task 4): the matching classification/TurningLine for
  // this point's ply (lookup done once by the caller), and whether this
  // card's own "replay" is the one currently driving the board — the
  // four-part note only renders under the active card, mirroring the
  // arrows GamePage threads onto the board for that same click.
  classification: MoveClassification | undefined;
  line: TurningLine | undefined;
  active: boolean;
  // Increment 3.91 (Task 6): "try the line" seeds a live sandbox at this
  // card's own ply (GamePage's openExplore). `exploring` disables every
  // card's replay/try-line buttons while a session is already running — the
  // banner's own "exit" is the one sanctioned way back to a static debrief,
  // so a second card can't be clicked out from under the live board.
  onTryLine: (ply: number) => void;
  exploring: boolean;
}

function TurningPointCard({ point, onRewind, classification, line, active, onTryLine, exploring }: TurningPointCardProps) {
  // debrief-v2: an episode card is a warning-class fact by construction (a
  // sustained king-pressure run), so it always gets the magenta tint —
  // same flat-tint card family as a negative-labeled swing/backfill card,
  // just a different reason.
  const isEpisode = point.kind === "episode";
  const negative = NEGATIVE_CARD_LABELS.has(point.label) || isEpisode;
  const startMove = moveNumberForPly(point.ply);
  const endMove = point.plyEnd != null ? moveNumberForPly(point.plyEnd) : startMove;
  const note = active ? buildTurningPointNote(point, classification, line) : null;
  return (
    <div className={"debrief-card" + (negative ? " debrief-card-negative" : "")}>
      <div className="debrief-card-head">
        <span className="debrief-card-kicker">{isEpisode ? `moves ${startMove}-${endMove}` : `move ${startMove}`}</span>
        {point.lowConfidence && <span className="debrief-card-lowconf">(eval gap here)</span>}
      </div>
      <p className="debrief-card-prose">
        {isEpisode
          ? "king pressure · her pieces camped on your king"
          : `${point.missedPunish ? "the miss · " : ""}${point.san} · ${point.label}`}
      </p>
      {point.punishSan && <p className="debrief-card-punish">you punished with {point.punishSan}</p>}
      <button className="small debrief-replay-btn" disabled={exploring} onClick={() => onRewind(point.ply)}>
        replay
      </button>
      <button className="small debrief-tryline-btn" disabled={exploring} onClick={() => onTryLine(point.ply)}>
        try the line
      </button>
      {note && (
        <>
          {note.didWell && <p className="debrief-card-punish">did well: {note.didWell}</p>}
          {note.couldImprove && <p className="debrief-card-punish">could improve: {note.couldImprove}</p>}
          <p className="debrief-card-punish">next time: {note.nextTime}</p>
          {note.whatMayHaveHappened && (
            <p className="debrief-card-punish">what may have happened: {note.whatMayHaveHappened}</p>
          )}
        </>
      )}
    </div>
  );
}

// debrief-v2: the three fixed-order bullet sections replacing the single
// lesson sentence. Section groups are only rendered when they have at
// least one bullet (debriefBullets guarantees every section is non-empty
// in practice, but this stays defensive rather than assuming).
const BULLET_SECTION_ORDER: DebriefBullet["section"][] = ["done well", "could be better", "watch next time"];

function DebriefBulletList({
  bullets,
  onRewind,
  exploring,
}: {
  bullets: DebriefBullet[];
  onRewind: (ply: number) => void;
  // Increment 3.91 (Task 6): same "the live board can't be yanked out from
  // under itself" rule as TurningPointCard's replay/try-line buttons.
  exploring: boolean;
}) {
  return (
    <div className="debrief-bullets">
      {BULLET_SECTION_ORDER.map((section) => {
        const items = bullets.filter((b) => b.section === section);
        if (items.length === 0) return null;
        return (
          <div className="debrief-bullet-section" key={section}>
            <span className="debrief-bullet-kicker">{section}</span>
            {items.map((b, i) => (
              <div className="debrief-bullet" key={i}>
                <p className="debrief-bullet-text">{b.text}</p>
                <div className="debrief-bullet-foot">
                  <span className="debrief-bullet-tag">
                    {b.phase} · {b.category}
                  </span>
                  {b.ply != null && (
                    <button
                      className="small debrief-replay-btn"
                      disabled={exploring}
                      onClick={() => onRewind(b.ply!)}
                    >
                      replay
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export interface DebriefReviewing {
  opponent: string;
  result: string;
}

export interface DebriefPageProps {
  turningPoints: TurningPoint[];
  // debrief-v2: the bullets' fuller-net could-be-better source (turning
  // points alone can dedup away a real mistake — see turningPoints.ts's
  // dedup comment) and the ply count phase derivation needs. Both come
  // straight off SummaryResponse (classifications, moves.length).
  classifications: MoveClassification[];
  // Increment 3.91 (Task 4): the persisted per-turning-point PV/best-move
  // lines, fetched once by GamePage and passed straight through (see the
  // TurningLine comment in game/api.ts) — a point missing here (e.g. no
  // pv/best_move persisted for that ply) simply renders the note without
  // the whatMayHaveHappened/couldImprove-bestClause parts.
  turningLines: TurningLine[];
  totalPlies: number;
  // The finished game's result — live path passes gameOver.result, review
  // path passes reviewGame.result. Both are plain strings on the wire
  // (GameOverInfo/GameListEntry); debriefBullets narrows to its own
  // "1-0" | "0-1" | "1/2-1/2" | null domain. Required (not derived from
  // `reviewing`) because the live debrief has no `reviewing` prop but still
  // needs the result to pick an honest bullet set (post 3c-review F1,
  // carried forward into debrief-v2).
  result: string | null;
  rewindPly: number | null;
  onRewind: (ply: number) => void;
  onBackToEnd: () => void;
  onOpenPastGames: () => void;
  // Set only when this DebriefPage is rendering a past game in REVIEW MODE
  // rather than the just-finished live game's own debrief.
  reviewing?: DebriefReviewing;
  onBackToPlay?: () => void;
  // Increment 3.91 (Task 6): GamePage owns the actual sandbox (src/game/
  // explore.ts's ExploreState) — this component only ever sees a small
  // read-only projection of it (null while no session is running) plus the
  // two entry points. `thinking` shows while GamePage's exploreReply call is
  // in flight; `over` marks a sandbox position that hit checkmate/stalemate
  // (nothing left to play, but the session stays open until "exit").
  exploring: { thinking: boolean; over: boolean } | null;
  onTryLine: (ply: number) => void;
  onExitExplore: () => void;
}

export function DebriefPage({
  turningPoints,
  classifications,
  turningLines,
  totalPlies,
  result,
  rewindPly,
  onRewind,
  onBackToEnd,
  onOpenPastGames,
  reviewing,
  onBackToPlay,
  exploring,
  onTryLine,
  onExitExplore,
}: DebriefPageProps) {
  const bullets = debriefBullets({
    turningPoints,
    classifications,
    result: result === "1-0" || result === "0-1" || result === "1/2-1/2" ? result : null,
    totalPlies,
  });
  return (
    <div className="debrief pop-in">
      {reviewing && (
        <div className="debrief-review-banner">
          <span className="debrief-review-kicker">reviewing</span>
          <span className="debrief-review-meta">
            mallow {eloFromOpponent(reviewing.opponent)} · {resultWord(reviewing.result)}
          </span>
          <button className="small" onClick={onBackToPlay}>
            back to play
          </button>
        </div>
      )}
      {/* Increment 3.91 (Task 6): the sandbox's own banner — the only way
          out is its "exit" button, deliberately separate from "back to
          play"/"back to the end" above so a live board is never abandoned
          by a click that meant something else. */}
      {exploring && (
        <div className="debrief-explore-banner">
          <span className="debrief-explore-kicker">trying the line</span>
          <span className="debrief-explore-meta">
            {exploring.over
              ? "the line ended. exit to keep browsing"
              : exploring.thinking
                ? "mallow is thinking..."
                : "play it out, nothing is saved"}
          </span>
          <button className="small" onClick={onExitExplore}>
            exit
          </button>
        </div>
      )}
      <DebriefBulletList bullets={bullets} onRewind={onRewind} exploring={!!exploring} />
      {turningPoints.length > 0 && (
        <div className="debrief-cards">
          {turningPoints.map((point) => (
            <TurningPointCard
              key={point.rank}
              point={point}
              onRewind={onRewind}
              classification={classifications.find((c) => c.ply === point.ply)}
              line={turningLines.find((l) => l.ply === point.ply)}
              active={rewindPly === point.ply}
              onTryLine={onTryLine}
              exploring={!!exploring}
            />
          ))}
        </div>
      )}
      <div className="debrief-footer">
        {rewindPly != null && !exploring && (
          <button className="small" onClick={onBackToEnd}>
            back to the end
          </button>
        )}
        {!reviewing && !exploring && <PastGamesButton onClick={onOpenPastGames} />}
      </div>
    </div>
  );
}

export function PastGamesButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="small past-games-btn" onClick={onClick}>
      past games
    </button>
  );
}

export interface PastGamesDrawerProps {
  open: boolean;
  games: GameListEntry[] | null;
  onSelect: (game: GameListEntry) => void;
  onClose: () => void;
}

export function PastGamesDrawer({ open, games, onSelect, onClose }: PastGamesDrawerProps) {
  if (!open) return null;
  return (
    <div className="past-games-overlay" role="dialog" aria-label="past games">
      <div className="past-games-drawer pop-in">
        <div className="past-games-drawer-head">
          <span className="past-games-title">past games</span>
          <button className="small" onClick={onClose}>
            close
          </button>
        </div>
        {games === null && <p className="past-games-empty">loading...</p>}
        {games !== null && games.length === 0 && <p className="past-games-empty">no finished games yet.</p>}
        {games !== null && games.length > 0 && (
          <div className="past-games-list">
            {games.map((g) => (
              <button key={g.id} className="past-games-row" onClick={() => onSelect(g)}>
                <span className="past-games-date">{g.startedAt.slice(0, 10)}</span>
                <span className="past-games-opponent">mallow {eloFromOpponent(g.opponent)}</span>
                <span className="past-games-result">{resultWord(g.result)}</span>
                <span className="past-games-lesson">{g.lesson ?? "no clear lesson yet"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
