// D3 badge wave (owner approvals 2026-09-01, verbatim: "I approve the
// components for the badges in option 1a for the logic and the momentum
// words."). Pure render-layer badge mapper -- every word maps from fields
// the review already computes (the library sec-d3-card-language rev 2 logic
// bullets are the spec). No new detection, no db change, no LLM.
//
// The two laws (library law card):
//   law 1 -- color is the side. Side always comes from a DATA field
//   (tp.leader, the label's own "opponent" prefix, deltaP's documented
//   signed-white-perspective convention, the gameSans row's side field, the
//   game result) -- NEVER re-derived from ply parity (standing rule,
//   ply-parity-encode-in-types-not-helpers).
//   law 2 -- fill is magnitude. hard = mistake/blunder grade or a
//   game-decider (the takeover, the finish, the miss); soft = inaccuracy
//   grade or informational (the siege, a lesser swing).

import type { TurningPoint, TurningLine, SummaryMove } from "../game/api";
import { followedBest } from "./followedBest";

export type BadgeWord =
  | "the crack"
  | "the slip"
  | "the punish"
  | "the miss"
  | "the swing"
  | "the takeover"
  | "the finish"
  | "the siege";

export interface CardBadge {
  word: BadgeWord;
  side: "her" | "mallow";
  hard: boolean;
}

// Context the mapper needs beyond the point itself: the game result (the
// finish badge's fallback side source), and the point's TurningLine +
// gameSans so the punish can be confirmed through followedBest -- the SAME
// independently-measured fact turningPointNote.ts's buildDidWell already
// uses for the quiet-punish case turningPoints.ts's own capture-only
// credit-assignment (attachPunishSuffix) never records.
export interface BadgeContext {
  result?: string | null;
  line?: TurningLine;
  gameSans?: SummaryMove[];
}

// law 2 in field terms (library logic bullet): hard when the severity label
// is mistake or blunder grade -- covers both her labels ("blunder") and
// mallow's ("opponent blunder").
function labelIsHard(label: string): boolean {
  return label.includes("blunder") || label.includes("mistake");
}

// Her own eval-band labels exactly as classifications.ts/turningPoints.ts
// mint them -- the "opponent " prefix is mallow's set, checked separately.
const HER_BAND_LABELS = new Set(["blunder", "mistake", "inaccuracy"]);

// The finish badge's side, resolved from data only, in order:
// (1) the gameSans row for the mate ply carries an explicit side field
//     (SummaryMove.side, the W5 "encode the side in data" field);
// (2) the game result context -- the finish is the mating sequence that
//     ended it, so the winner's side delivered it ("1-0" her, "0-1" mallow);
// (3) label content alone: turningPoints.ts:698 mints the "checkmate"
//     backfill label only on the she-won path (sheLost mints "the losing
//     move" instead), and DebriefPage's own rendering already treats a
//     "checkmate" card as non-negative (her-win framing) -- so "her".
// Never ply parity.
function finishSide(tp: TurningPoint, ctx: BadgeContext): "her" | "mallow" {
  const row = ctx.gameSans?.find((m) => m.ply === tp.ply);
  if (row?.side) return row.side;
  if (ctx.result === "0-1") return "mallow";
  return "her";
}

// The followed-punish fact the note builder already uses (buildDidWell's
// even-ply followedBest branch, turningPointNote.ts): on an opponent
// turning point (even line ply -- the line's OWN documented seeding
// convention, not a parity guess about the mover) followedBest confirms her
// reply at ply+1 was the pv's recommended move.
function punishConfirmedByLine(ctx: BadgeContext): boolean {
  if (!ctx.line || ctx.line.ply % 2 !== 0) return false;
  const fb = followedBest(ctx.line, ctx.gameSans);
  return !!fb?.followed;
}

export function badgesForPoint(tp: TurningPoint, ctx: BadgeContext = {}): CardBadge[] {
  const badges: CardBadge[] = [];

  if (tp.kind === "lead-change") {
    // The leader field IS the side (library logic bullet: "the leader field
    // names the side"). Absent leader -> side not derivable from data ->
    // no badge, never a guess.
    if (tp.leader) badges.push({ word: "the takeover", side: tp.leader, hard: true });
    return badges;
  }

  if (tp.kind === "missed-win") {
    // A missed-win point is by construction HER missed forced mate (the
    // detector only ever scans her side -- missedWins.ts/conversion.ts),
    // and "the side whose chance it was" per the library definition.
    badges.push({ word: "the miss", side: "her", hard: true });
  } else if (tp.kind === "backfill") {
    // Only the delivered-mate label maps to a word; "the clincher" and
    // "the losing move" have no badge in the approved 1a vocabulary.
    if (tp.label === "checkmate") {
      badges.push({ word: "the finish", side: finishSide(tp, ctx), hard: true });
    }
  } else if (tp.kind === "episode") {
    // The card keeps its existing king-pressure framing (the library's
    // definitions row: the siege keeps its existing name); informational,
    // so soft, and mallow's pressure, so mallow's side.
    badges.push({ word: "the siege", side: "mallow", hard: false });
  } else if (tp.label.startsWith("opponent")) {
    const hard = labelIsHard(tp.label);
    // The punish leads when confirmed -- grounded on the library's own m18
    // specimen (the cyan card: the punish first, and the card's 3px left
    // tint follows the FIRST badge's family, which m18 renders cyan/her).
    if (tp.punishSan || punishConfirmedByLine(ctx)) {
      badges.push({ word: "the punish", side: "her", hard });
    }
    badges.push({ word: "the crack", side: "mallow", hard });
  } else if (HER_BAND_LABELS.has(tp.label)) {
    badges.push({ word: "the slip", side: "her", hard: labelIsHard(tp.label) });
  }

  // The lead-FLAG case (leader set on a point of another kind): the
  // move-18 shape -- the card also wears the takeover, sided by the leader
  // field, always hard.
  if (tp.leader) {
    badges.push({ word: "the takeover", side: tp.leader, hard: true });
  }

  // The rank-1 PLAIN swing additionally gets the swing. "Plain" = kind
  // "swing" and NOT lead-flagged: the brief's own "three badges max" count
  // (punish + crack + takeover on a flagged punish point, or punish +
  // crack + swing on a plain one) only closes under that reading -- a
  // flagged point's magnitude story is already the takeover's. Beneficiary
  // from deltaP's documented signed-white-perspective convention
  // (turningPoints.ts:44: "deltaP: signed, white perspective"; she is
  // always white): > 0 favors her, < 0 favors mallow, exactly 0 is not
  // derivable and emits nothing.
  if (tp.rank === 1 && tp.kind === "swing" && !tp.leader && tp.deltaP !== 0) {
    badges.push({
      word: "the swing",
      side: tp.deltaP > 0 ? "her" : "mallow",
      hard: labelIsHard(tp.label),
    });
  }

  return badges;
}
