// D1 "cipher rail" -- the six-state arrow legend's pure row model.
//
// Port of the approved mockup (vault "3 visual/Girl Chess — Arrow Legend
// (mockup, 2026-07-28).html", direction D1, owner-selected). AnalysisLegend
// .tsx just maps this list to markup -- same split debriefBullets.ts/
// DebriefBulletList already use, since .tsx has no unit-test harness here.
//
// The six kinds are exactly reviewArrows.ts's ArrowColor union (imported,
// not re-declared) so a future arrow kind can't silently drift out of sync
// with the legend that explains it -- see analysisLegend.test.ts's
// "covers every ArrowColor" assertion.
//
// Colours are pinned to the REAL shipped arrow CSS (src/skin/sugar-
// glitch.css .arrow-played/.arrow-best/.arrow-threat/.arrow-found/
// .arrow-mallow/.arrow-mallow-best, commit c199c55), not re-derived from
// the mockup's own swatch script -- if a swatch and the real arrow ever
// disagree, the swatch is the bug (owner ruling).
import type { ArrowColor } from "../game/reviewArrows";

export type LegendStyle = "solid" | "dashed";

export interface LegendRow {
  kind: ArrowColor;
  label: string;
  style: LegendStyle;
  // Primary swatch stroke/fill colour -- matches the real arrow's own CSS
  // colour exactly (see file header).
  color: string;
  // Only "found" carries a second colour: the cyan under-stroke/outline
  // beneath the green body (.arrow-found's halo layer).
  haloColor?: string;
}

const CYAN = "#23E5FF"; // your move -- .arrow-played
const GREEN = "rgb(76,175,140)"; // engine's counsel -- .arrow-best / .arrow-found body
const ROSE = "#C22B7E"; // mallow -- .arrow-mallow / .arrow-mallow-best

// "solid -- it happened" cluster. Order matches the mockup/spec panel.
//
// The solid #FF3DA6 "a real threat" row was REMOVED 2026-07-28 (owner ruling,
// prompted by the visual gate). Nothing in the app emits a threat-coloured
// arrow any more, in review OR in live play -- grep for a producer returns
// none. It went dead the moment solid=happened/dashed=didn't became the rule,
// because a punishment mallow did NOT play has to be dashed under it. A
// legend row for a state that cannot render is worse than no row: it teaches
// a colour the player will never see and then leaves her waiting for it.
// #FF3DA6 stays reserved in the palette as the only alarm colour.
export const LEGEND_SOLID_ROWS: LegendRow[] = [
  { kind: "played", label: "your move", style: "solid", color: CYAN },
  { kind: "found", label: "you found the best move", style: "solid", color: GREEN, haloColor: CYAN },
  { kind: "mallow", label: "mallow's move", style: "solid", color: ROSE },
];

// "dashed -- it didn't" cluster.
//
// "recommended move" (owner ruling 2026-07-29): this arrow is
// moves.best_move -- the engine's recommended move at that moment. A noun
// phrase, parallel to "your move" / "mallow's move"; "you should've"
// scolds. The ruling confirms the row SPLIT: this dashed green row reads
// "recommended move" while the solid green row keeps "you found the best
// move" -- do not harmonize them.
//
// "what your move allowed" (owner ruling 2026-07-28, SUPERSEDED 2026-08-05
// below): this arrow was threatForPly -- the refutation of the move SHE
// PLAYED, i.e. how mallow could have punished it (manager.ts:520). Correct
// while mallow-best only ever meant that.
//
// Voice-consistent four-arrow model (owner ruling, 2026-08-05): mallow-best
// now fills TWO different slots depending on which card it's drawn on (see
// reviewArrows.ts's own header for the full R1/R2 story) -- odd card (mallow
// is the OTHER actor): sourced from line.threat, the refutation of the move
// SHE played; even card (mallow is the SUBJECT): sourced from mallow's own
// alternative (moverBestFromTo), which has nothing to do with her move at
// all. A parity-aware label was tried and reverted the same day (a
// `mallowBestLabel(source)` function existed briefly): it was incoherent by
// construction, because this legend is a SINGLE GLOBAL RAIL rendered once
// for the whole debrief, not scoped per card -- it cannot be simultaneously
// true for every card on screen, and its only production call site was
// hardcoded to the "threat" branch anyway, so the "moverBest" branch was
// dead code that shipped a false label on every even-card mallow turning
// point.
//
// Fix (2026-08-05, one-string label, owner-reversible): "mallow's
// recommended move" is true in BOTH cases -- the rose dashed arrow always
// means "mallow's best move in that position," whether it's punishing her
// move or standing in for mallow's own alternative. This parallels the green
// dashed row's "recommended move" (owner ruling 2026-07-29) so the rail now
// reads consistently: green dashed = the engine's pick for her, rose dashed
// = the engine's pick for mallow.
export const LEGEND_DASHED_ROWS: LegendRow[] = [
  { kind: "best", label: "recommended move", style: "dashed", color: GREEN },
  { kind: "mallow-best", label: "mallow's recommended move", style: "dashed", color: ROSE },
];

// All five, solid cluster first -- the order the rail actually renders in.
export const LEGEND_ROWS: LegendRow[] = [...LEGEND_SOLID_ROWS, ...LEGEND_DASHED_ROWS];
