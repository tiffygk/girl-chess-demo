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

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GameListEntry, MoveClassification, TurningPoint, TurningLine, SummaryMove } from "../game/api";
// Wave 3.5, item 2 (owner ask, 2026-08-01): the past-games delete X's
// two-step "you sure?" arm/disarm state -- pure, unit-tested on its own
// (deleteArm.test.ts) since PastGamesDrawer itself has no interactive
// component test harness (see this file's DebriefPage.test.tsx sibling,
// which only ever renders via renderToStaticMarkup -- no onClick fires
// there).
import { clickDelete, disarmArmed, type ArmState } from "./deleteArm";
// Round 2, item 9 (owner ruling, 2026-08-01 playtest): render startedAt in
// the viewer's local timezone, not a raw slice of the server's UTC string.
import { localDateFromStartedAt } from "./localDate";
import { moveNumberForPly } from "./debriefLesson";
import { debriefBullets, affordancesForBullet, type DebriefBullet } from "./debriefBullets";
// Increment 3.91 (Task 4): the four-part note, rendered under a turning-
// point card once its own "replay" has been clicked (see `active` below).
// Pure/deterministic module — see turningPointNote.ts's header for why it
// deliberately doesn't import from debriefBullets.ts.
// Increment 3.95 (Task 4, Part 1): opportunityForLine is the same helper
// buildTurningPointNote uses internally, reused directly here so the
// try-the-line banner (which never calls buildTurningPointNote — it has no
// TurningPoint/classification, just a ply) can render the identical honest
// clause for whichever line the sandbox was seeded from.
import { buildTurningPointNote, opportunityForLine } from "./turningPointNote";
// Legend card-scope fix (2026-07-29): the legend must ask the real arrow
// producer whether a line draws a mallow-best arrow, never re-derive the
// coincidence rule (that duplication is what caused the bug -- see
// computeShowAllowedRow below). followedBest is the same played-vs-best
// replay every other played/best comparison in this file already routes
// through (never hand-roll a squares comparison).
import { turningLineArrows } from "../game/reviewArrows";
import { followedBest } from "./followedBest";
// Increment 3.95 (Task 10): the full-game move-list navigator, rendered
// alongside the turning-point cards below using props this page already
// has in hand (gameSans, rewindPly, onRewind, exploring) — no new props on
// DebriefPage itself. File is MoveListNav.tsx (not MoveList.tsx) to dodge a
// macOS case-insensitive-filesystem collision with the pure moveList.ts
// helper it wraps — same directory, names differing only by case, which
// trips up TS module resolution (tried and reverted; see task-10 report).
// The exported component itself is still named MoveList.
import { MoveList } from "./MoveListNav";
// Debrief Plain-English Notation round (Task 3): the turning-point card
// title's SAN ("Nd5 · opponent inaccuracy") reads as raw notation to a
// beginner — rendered in plain English via the same describeSanMove/fenAtPly
// seam turningPointNote.ts/debriefBullets.ts now share, falling back to raw
// SAN when the renderer can't place the move.
import { fenAtPly } from "./Rewind";
import { describeSanMove, stripRedundantCheckSuffix } from "../game/describeSanMove";
// D1 "cipher rail" (analysis legend round, 2026-07-28): the six-state arrow
// key, first child of this block per the owner's approved mockup direction
// -- see AnalysisLegendRail.tsx's header for the geometry source (and its
// own note on why the file isn't named AnalysisLegend.tsx) and
// analysisLegend.test.ts for the gating pin (this component only ever
// renders inside DebriefPage, which is itself analysis/review-only).
import { AnalysisLegend } from "./AnalysisLegendRail";
// Highlight-a-move (Task 6): the study ledger — her live highlights, pulled
// into their own section between the bullets and the turning-point cards
// (her chosen moments immediately before the machine's chosen moments, peer
// to peer). Pure row model in highlightedMoves.ts; render in
// HighlightedMovesSection.tsx. Zero highlights renders nothing at all.
import { buildHighlightedRows } from "./highlightedMoves";
import { HighlightedMovesSection } from "./HighlightedMovesSection";

// Her own negative move labels — same set debriefLesson.ts uses to find her
// worst point, reused here to decide which cards get the magenta tint.
// "the losing move" (an opponent-side backfill point naming the moment she
// was already lost) is negative in outcome even though she didn't play it,
// so it gets the same tint; every other label (opponent errors, checkmate,
// the clincher, strong move) stays the lavender default.
// Missed-win round (2026-07-28): "missed mate" joins the negative-tint set —
// a forced mate she had and played past is the game's alarm moment, exactly
// as much as a blunder is.
// Union review consistency fix (2026-07-31): "conversion" joins the same
// set, on the same grounds "missed mate" did — she had a win and gave it
// back is exactly the same class of fact, whether the card names the
// mate distance directly (missed mate) or the run that let it slip
// (conversion). Without this a pink "missed mate" card sat beside a plain
// "conversion" card asserting the identical alarm.
const NEGATIVE_CARD_LABELS = new Set([
  "blunder",
  "mistake",
  "inaccuracy",
  "the losing move",
  "missed mate",
  "conversion",
]);

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

// Round 2, item 6 (owner ruling, 2026-08-01 playtest): the idle delete X was
// "slightly too low (not vertically centered)" -- a bare "×" text glyph's
// on-screen position rides on the font's own ascent/descent metrics, which
// is exactly the kind of thing that silently drifts. A geometric SVG glyph
// (two crossing lines, same construction the settings-gear icon already
// uses -- GamePage.tsx's gear-svg) makes centering a layout fact instead of
// a font fact: stroke=currentColor so it inherits .past-games-delete's CSS
// color/hover rules with no duplicated palette. Idle state only -- the
// armed "sure?" state stays plain text, untouched (owner: keep its color
// exactly as is).
function DeleteXIcon() {
  return (
    <svg className="past-games-delete-icon" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="2" y1="2" x2="10" y2="10" />
        <line x1="10" y1="2" x2="2" y2="10" />
      </g>
    </svg>
  );
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
  // Increment 3.95 (Task 4, Part 1): the full game's SAN move list, passed
  // straight through from GamePage's own activeReviewMoves — buildTurningPointNote
  // needs it to reconstruct the pv's seed position (fenAtPly) for the
  // opportunity clause. Absent (undefined) simply means no opportunity
  // clause renders, never a guessed one.
  gameSans: SummaryMove[] | undefined;
  active: boolean;
  // Increment 3.91 (Task 6): "try the line" seeds a live sandbox at this
  // card's own ply (GamePage's openExplore). `exploring` disables every
  // card's replay/try-line buttons while a session is already running — the
  // banner's own "exit" is the one sanctioned way back to a static debrief,
  // so a second card can't be clicked out from under the live board.
  onTryLine: (ply: number) => void;
  exploring: boolean;
  // Increment 3.95, Task 7 ("ask about this" chat): opens the single
  // always-mounted CoachChat scoped to THIS card — GamePage looks up the
  // matching TurningLine itself (it already holds turningLines), so this
  // component only ever hands back the point, never a pre-built context.
  onAskAboutThis: (point: TurningPoint) => void;
}

function TurningPointCard({
  point,
  onRewind,
  classification,
  line,
  gameSans,
  active,
  onTryLine,
  exploring,
  onAskAboutThis,
}: TurningPointCardProps) {
  // debrief-v2: an episode card is a warning-class fact by construction (a
  // sustained king-pressure run), so it always gets the magenta tint —
  // same flat-tint card family as a negative-labeled swing/backfill card,
  // just a different reason.
  const isEpisode = point.kind === "episode";
  const negative = NEGATIVE_CARD_LABELS.has(point.label) || isEpisode;
  const startMove = moveNumberForPly(point.ply);
  const endMove = point.plyEnd != null ? moveNumberForPly(point.plyEnd) : startMove;
  const note = active ? buildTurningPointNote(point, classification, line, gameSans) : null;
  const fenBeforePoint = gameSans && point.ply >= 1 ? fenAtPly(gameSans, point.ply - 1) : undefined;
  const describedSan = fenBeforePoint ? describeSanMove(point.san, fenBeforePoint) : null;
  // Visual-gate catch (2026-07-22): the title appends "· {label}" right
  // after the rendered move, so a "checkmate"/"check" label would otherwise
  // duplicate describeSanMove's own trailing suffix.
  const describedSanForTitle = describedSan ? stripRedundantCheckSuffix(describedSan, point.label) : describedSan;
  // The punish move (point.punishSan) is played ONE PLY AFTER point.san, so
  // its own fen-before is the position after point.ply moves — the same
  // fenAtPly seam, one ply later than the point's own fen above.
  const punishFen = gameSans ? fenAtPly(gameSans, point.ply) : undefined;
  const describedPunish =
    point.punishSan && punishFen ? describeSanMove(point.punishSan, punishFen) : null;
  return (
    <div className={"debrief-card" + (negative ? " debrief-card-negative" : "")}>
      <div className="debrief-card-head">
        <span className="debrief-card-kicker">{isEpisode ? `moves ${startMove}-${endMove}` : `move ${startMove}`}</span>
        {point.lowConfidence && <span className="debrief-card-lowconf">(eval gap here)</span>}
      </div>
      <p className="debrief-card-prose">
        {isEpisode
          ? "king pressure · her pieces camped on your king"
          : `${point.missedPunish ? "the miss · " : ""}${describedSanForTitle ?? point.san} · ${point.label}`}
      </p>
      {point.punishSan && (
        <p className="debrief-card-punish">you punished with {describedPunish ?? point.punishSan}</p>
      )}
      <button className="small debrief-replay-btn" disabled={exploring} onClick={() => onRewind(point.ply)}>
        replay
      </button>
      <button className="small debrief-tryline-btn" disabled={exploring} onClick={() => onTryLine(point.ply)}>
        try the line
      </button>
      <button
        className="small debrief-ask-btn"
        disabled={exploring}
        onClick={() => onAskAboutThis(point)}
      >
        ask about this
      </button>
      {note && (
        <>
          {note.didWell && <p className="debrief-card-punish">did well: {note.didWell}</p>}
          {note.couldImprove && <p className="debrief-card-punish">could improve: {note.couldImprove}</p>}
          {note.nextTime && <p className="debrief-card-punish">next time: {note.nextTime}</p>}
          {note.whatMayHaveHappened && (
            <p className="debrief-card-punish">what may have happened: {note.whatMayHaveHappened}</p>
          )}
          {note.opportunity && <p className="debrief-card-punish">this opens up: {note.opportunity}.</p>}
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
  turningLines,
  gameSans,
  onRewind,
  onTryLine,
  onAskAbout,
  exploring,
}: {
  bullets: DebriefBullet[];
  // Union-review fix (2026-07-28, finding 3): threaded through to
  // affordancesForBullet so "try the line" only renders when a matching
  // TurningLine actually names a better move than what she played -- see
  // that function's own comment (debriefBullets.ts) for the two symptoms
  // this closes (a done-well bullet with nothing better to try, and a
  // classification-fallback ply with no line to seed a sandbox from).
  turningLines: TurningLine[];
  // Visual gate 2026-07-28: turningLines ALONE is not enough. Judging "is
  // there a better line" needs the move she actually replied with at
  // seedPly+1, which only gameSans carries -- without it, an opponent
  // turning point she punished perfectly still showed "try the line".
  gameSans: SummaryMove[] | undefined;
  onRewind: (ply: number) => void;
  // Coach truth-speed round (Wave C1, 2026-07-27): a bullet earns the SAME
  // three affordances a TurningPointCard already has (replay/try the line/
  // ask about this) — the owner's report was that a "could be better" note
  // had none of them, just like every other note. Bullets are NOT promoted
  // to cards: a classification-fallback bullet only ever carries
  // {ply, classification} (debriefBullets.ts), and inventing rank/deltaP/
  // lowConfidence/kind to make one look like a card would both fabricate
  // fields no fact supports and double-render the same ply as both a bullet
  // and a card.
  onTryLine: (ply: number) => void;
  onAskAbout: (ply: number) => void;
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
            {items.map((b, i) => {
              // Coach truth-speed round (Wave C1): consumes wave A1's own
              // exported gate rather than re-deriving "does this bullet have
              // a ply" locally — one source of truth for the affordance
              // gate, same discipline the rest of this file follows for
              // other shared facts.
              const aff = affordancesForBullet(b, turningLines, gameSans);
              return (
                <div className="debrief-bullet" key={i}>
                  <p className="debrief-bullet-text">{b.text}</p>
                  <div className="debrief-bullet-foot">
                    <span className="debrief-bullet-tag">
                      {/* Important 5 / union F1 (2026-07-30 fix wave): b.phase is
                          null when there is no board to derive a phase from
                          (gameSans absent/empty) -- omit the phase word rather
                          than printing a fact that was never proven. */}
                      {b.phase ? (
                        <>
                          {b.phase} · {b.category}
                        </>
                      ) : (
                        b.category
                      )}
                    </span>
                    {aff.replay && (
                      <button
                        className="small debrief-replay-btn"
                        disabled={exploring}
                        onClick={() => onRewind(b.ply!)}
                      >
                        replay
                      </button>
                    )}
                    {aff.tryLine && (
                      <button
                        className="small debrief-tryline-btn"
                        disabled={exploring}
                        onClick={() => onTryLine(b.ply!)}
                      >
                        try the line
                      </button>
                    )}
                    {aff.ask && (
                      <button
                        className="small debrief-ask-btn"
                        disabled={exploring}
                        onClick={() => onAskAbout(b.ply!)}
                      >
                        ask about this
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// A6 (rca.md section E / root cause 10, threat-arrow-decision.md): whether
// the legend's dashed rose "what your move allowed" row should render at
// all this game. `line.threat` is populated only from a verdicts row keyed
// on (ply, san) -- and verdicts are written exclusively on HER own
// candidate moves (followedBest.ts's ply-parity header), so an even-ply
// (opponent) turning point can never carry one: 0 of 31 in the whole db.
//
// Union-review 2026-07-29 (finding 1, feedback.md this round): `!!l.threat`
// was still the wrong test even after the A6 fix above, because the real
// arrow producer (turningLineArrows, reviewArrows.ts) applies a SECOND test
// this function didn't: it suppresses the mallow-best arrow whenever mallow's
// ACTUAL reply coincides with the recommended refutation (game 151's ply 43
// shape). `!!l.threat` says show, the board draws nothing -- the legend
// promised a colour the board never draws. Owner ruling this round: fix it
// card-scoped, not a strict "mirror the literal board arrows" (landing state
// has zero arrows on the board, so a literal mirror would hide every row).
//
// Two-branch design (ruled, do not improvise):
//   - a card is selected (rewindPly != null): show the row only if THAT
//     line actually draws a mallow-best arrow. No line for that ply (a
//     MoveList jump to a non-turning-point ply) -> hide, never throw.
//   - nothing selected (rewindPly == null, the landing state): fall back to
//     game-scoped, but using the same real producer test -- show if ANY line
//     in the game would draw a mallow-best arrow. This is the branch that
//     fixes game 151 (no card is selected on first landing).
// Both branches route through turningLineArrows so the legend can never
// drift from the board again -- the coincidence rule is never re-derived
// here, only asked of the one place it's already implemented.
function lineDrawsAllowedArrow(line: TurningLine, gameSans: SummaryMove[]): boolean {
  return turningLineArrows(line, followedBest(line, gameSans), gameSans).some(
    (a) => a.color === "mallow-best"
  );
}

export function computeShowAllowedRow(
  turningLines: TurningLine[] | undefined,
  gameSans: SummaryMove[] = [],
  rewindPly: number | null = null
): boolean {
  if (!turningLines) return false;
  if (rewindPly != null) {
    const line = turningLines.find((l) => l.ply === rewindPly);
    return line ? lineDrawsAllowedArrow(line, gameSans) : false;
  }
  return turningLines.some((l) => lineDrawsAllowedArrow(l, gameSans));
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
  // Increment 3.95 (Task 4, Part 1): the full game's SAN move list (GamePage's
  // own activeReviewMoves), threaded straight through so a turning-point
  // card's opportunity clause and the try-the-line banner below can both
  // reconstruct the pv's seed position via fenAtPly — see
  // turningPointNote.ts's opportunityForLine.
  gameSans: SummaryMove[];
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
  // (nothing left to play, but the session stays open until "exit"). `ply`
  // (Task 4, Part 1) is the turning point's own ply the sandbox was seeded
  // from (same convention as onRewind/turningLines lookups) — carried so the
  // banner can look up the matching TurningLine and render its opportunity
  // clause; null only if a session were somehow open with no seed ply on
  // record, in which case the banner simply omits the clause.
  exploring: { thinking: boolean; over: boolean; ply: number | null } | null;
  onTryLine: (ply: number) => void;
  onExitExplore: () => void;
  // Increment 3.95, Task 7: threaded straight through to every
  // TurningPointCard — see that prop's own comment.
  onAskAboutTurningPoint: (point: TurningPoint) => void;
  // Coach truth-speed round (Wave C1, 2026-07-27): a bullet's own "ask about
  // this" — GamePage looks up a real TurningPoint by ply first, falling back
  // to a synthetic focus built from the ply's MoveClassification when no
  // TurningPoint exists there (see GamePage's handleAskAboutPly).
  onAskAboutPly: (ply: number) => void;
}

export function DebriefPage({
  turningPoints,
  classifications,
  turningLines,
  gameSans,
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
  onAskAboutTurningPoint,
  onAskAboutPly,
}: DebriefPageProps) {
  const bullets = debriefBullets({
    turningPoints,
    classifications,
    result: result === "1-0" || result === "0-1" || result === "1/2-1/2" ? result : null,
    totalPlies,
    // Debrief Plain-English Notation round (Task 3): lets the two raw-SAN
    // bullet spots (a could-be-better mistake, a done-well strong move)
    // render in plain English via fenAtPly, same seam every other debrief
    // module already shares.
    gameSans,
    // Review fix (Wave F, 2026-07-27, review.md finding 3): DebriefPage
    // already holds turningLines (used above for the explore banner and
    // below for arrows), but never passed it here -- so lineForPly always
    // returned undefined, fb was always undefined, and followedGoodText
    // could never render: a "could be better" bullet kept nudging her about
    // a move she actually played correctly. One-line wire-up; the
    // re-sectioning logic itself (buildCouldBeBetter) was already correct.
    turningLines,
  });
  // Increment 3.95 (Task 4, Part 1): the try-the-line banner has no
  // TurningPoint/classification to hand buildTurningPointNote — just the
  // seed ply the sandbox opened at — so it looks up the matching
  // TurningLine itself and derives the same honest opportunity clause
  // directly via opportunityForLine.
  const exploreLine = exploring?.ply != null ? turningLines.find((l) => l.ply === exploring.ply) : undefined;
  const exploreOpportunity = exploreLine ? opportunityForLine(exploreLine, gameSans) : undefined;
  // Highlight-a-move (Tasks 4+6): derived straight off gameSans (the summary
  // Task 1 widened), same "no new prop" pattern the rest of this component
  // already uses for gameSans-derived data. The list feeds the study ledger
  // (game order, since gameSans is ply-ordered); the Set feeds the recap.
  // Wave B D0 fix (opponent-move-analysis plan, 2026-08-03): W5 made both
  // sides highlightable, so the cyan HER-ledger must exclude mallow's
  // highlighted plies by the row's own `side` field (data, never ply
  // parity). `!== "mallow"` rather than `=== "her"` on purpose: a pre-W5
  // row with no side is hers by back-compat, only a PROVEN mallow row is
  // filtered. Mallow's highlights render in their own magenta sibling
  // below. The recap Set stays BOTH sides -- the move list marks every
  // flagged ply, whoever played it (the W5 behavior).
  const highlightedPlyList = gameSans
    .filter((m) => m.highlighted && m.side !== "mallow")
    .map((m) => m.ply);
  const highlightedPlies = new Set(gameSans.filter((m) => m.highlighted).map((m) => m.ply));
  const highlightedRows = buildHighlightedRows({
    highlightedPlies: highlightedPlyList,
    gameSans,
    turningLines,
    classifications,
    // Visual gate 2026-07-28: without this a highlighted ply where she had
    // mate in one rendered as "not-an-error" and printed "this cost you
    // nothing" -- classifyMoves grades by deltaP and a missed mate in a won
    // position moves it by ~0, so the classification ladder alone can never
    // see it. The missed-win point is the only fact that can.
    turningPoints,
  });
  return (
    <div className="debrief pop-in">
      <AnalysisLegend showAllowedRow={computeShowAllowedRow(turningLines, gameSans, rewindPly)} />
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
          {exploreOpportunity && <span className="debrief-explore-meta">this line {exploreOpportunity}.</span>}
          <button className="small" onClick={onExitExplore}>
            exit
          </button>
        </div>
      )}
      <DebriefBulletList
        bullets={bullets}
        turningLines={turningLines}
        gameSans={gameSans}
        onRewind={onRewind}
        onTryLine={onTryLine}
        onAskAbout={onAskAboutPly}
        exploring={!!exploring}
      />
      {highlightedRows.length > 0 && (
        <HighlightedMovesSection
          rows={highlightedRows}
          gameSans={gameSans}
          onRewind={onRewind}
          onTryLine={onTryLine}
          onAskAboutPly={onAskAboutPly}
          exploring={!!exploring}
        />
      )}
      {turningPoints.length > 0 && (
        <div className="debrief-cards">
          {turningPoints.map((point) => (
            <TurningPointCard
              key={point.rank}
              point={point}
              onRewind={onRewind}
              classification={classifications.find((c) => c.ply === point.ply)}
              line={turningLines.find((l) => l.ply === point.ply)}
              gameSans={gameSans}
              active={rewindPly === point.ply}
              onTryLine={onTryLine}
              exploring={!!exploring}
              onAskAboutThis={onAskAboutTurningPoint}
            />
          ))}
        </div>
      )}
      <MoveList
        sans={gameSans.map((m) => m.san)}
        currentPly={rewindPly}
        onSelect={onRewind}
        disabled={!!exploring}
        highlightedPlies={highlightedPlies}
      />
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

// Wave 3.5, item 2 (owner ask, 2026-08-01): how long the pointer has to stay
// off an armed row before it disarms on its own -- "I need to double click
// it so that I don't accidentally delete it" (owner) covers the deliberate
// two-click case; this covers the "armed it, walked away" case.
const DELETE_DISARM_MS = 3000;

export interface PastGamesDrawerProps {
  open: boolean;
  games: GameListEntry[] | null;
  onSelect: (game: GameListEntry) => void;
  onClose: () => void;
  // Wave 3.5, item 2: called only on the CONFIRMING second click (see
  // deleteArm.ts's clickDelete) -- GamePage.tsx owns the actual deleteGame()
  // api call, the optimistic row removal, and closing REVIEW MODE if the
  // deleted game is the one currently open there. This component only ever
  // decides WHEN that click counts as confirmed.
  onDelete: (gameId: number) => void;
  // Wave 3.5, item 2: set by GamePage after a failed delete (the row was
  // already restored by then) -- rendered inline, same past-games-empty
  // style the loading/empty states already use (no toast machinery exists
  // in this app).
  deleteError?: string | null;
}

export function PastGamesDrawer({ open, games, onSelect, onClose, onDelete, deleteError }: PastGamesDrawerProps) {
  const [armed, setArmed] = useState<ArmState>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDisarmTimer = useCallback(() => {
    if (disarmTimer.current != null) {
      clearTimeout(disarmTimer.current);
      disarmTimer.current = null;
    }
  }, []);

  // Disarm on: the drawer closing (below) and on unmount (cleanup) -- an
  // armed X must never survive being reopened later, possibly against a
  // completely different row set.
  useEffect(() => {
    if (!open) {
      setArmed(disarmArmed());
      clearDisarmTimer();
    }
  }, [open, clearDisarmTimer]);
  useEffect(() => clearDisarmTimer, [clearDisarmTimer]);

  if (!open) return null;

  // Disarm on: clicking anywhere else in the drawer. Attached to the
  // drawer's own root so a click on a DIFFERENT row's select button, the
  // close button, or the backdrop all bubble here -- the armed delete
  // button's own onClick below calls stopPropagation so its confirming
  // click never also triggers this (which would immediately undo the state
  // that same click just set).
  const disarmOnElsewhereClick = () => {
    clearDisarmTimer();
    setArmed(disarmArmed());
  };

  const handleDeleteClick = (e: ReactMouseEvent, gameId: number) => {
    e.stopPropagation();
    const result = clickDelete(armed, gameId);
    clearDisarmTimer();
    setArmed(result.next);
    if (result.fire) onDelete(gameId);
  };

  // Disarm on: pointer leaving the armed row for >3s. Only starts/matters
  // while THIS row is the armed one; re-entering before the timer fires
  // cancels it (armed survives a quick pass-over).
  const handleRowMouseLeave = (gameId: number) => {
    if (armed !== gameId) return;
    clearDisarmTimer();
    disarmTimer.current = setTimeout(() => setArmed(disarmArmed()), DELETE_DISARM_MS);
  };
  const handleRowMouseEnter = (gameId: number) => {
    if (armed === gameId) clearDisarmTimer();
  };

  return (
    <div className="past-games-overlay" role="dialog" aria-label="past games" onClick={disarmOnElsewhereClick}>
      <div className="past-games-drawer pop-in">
        <div className="past-games-drawer-head">
          <span className="past-games-title">past games</span>
          <button className="small" onClick={onClose}>
            close
          </button>
        </div>
        {deleteError && <p className="past-games-empty past-games-error">{deleteError}</p>}
        {games === null && <p className="past-games-empty">loading...</p>}
        {games !== null && games.length === 0 && <p className="past-games-empty">no finished games yet.</p>}
        {games !== null && games.length > 0 && (
          <div className="past-games-list">
            {games.map((g) => (
              <div
                key={g.id}
                className="past-games-row"
                onMouseLeave={() => handleRowMouseLeave(g.id)}
                onMouseEnter={() => handleRowMouseEnter(g.id)}
              >
                <button className="past-games-select" onClick={() => onSelect(g)}>
                  <span className="past-games-date">{localDateFromStartedAt(g.startedAt)}</span>
                  <span className="past-games-opponent">mallow {eloFromOpponent(g.opponent)}</span>
                  <span className="past-games-result">{resultWord(g.result)}</span>
                  <span className="past-games-lesson">{g.lesson ?? "no clear lesson yet"}</span>
                </button>
                <button
                  className={"past-games-delete" + (armed === g.id ? " armed" : "")}
                  aria-label={armed === g.id ? "confirm delete" : "delete game"}
                  onClick={(e) => handleDeleteClick(e, g.id)}
                >
                  {armed === g.id ? "sure?" : <DeleteXIcon />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
