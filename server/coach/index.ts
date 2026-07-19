import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ThreatFacts } from "../annotator/motifs";
import type { RecommendationFacts } from "../annotator/motifs";
import type { CoachBackend } from "./backends/types";
import { validateNarration } from "./validate";
import { recordAdviceTrace } from "./traces";

// F17 + F18 + F14 + F40: the coach's fact-list assembly, render-only
// validation, and narration loop. This file never imports an evaluator or
// touches chess.js's engine seam — everything it works with arrives
// already-derived from classify.ts/motifs.ts/hint.ts, by design (the coach
// is a pure "explain these facts with personality" layer, never a source of
// new chess truth).
export type NarrateSource = "model" | "template";

export interface CoachFactList {
  herMove: { pieceKind: string; from: string; to: string };
  tier: "nudge" | "warning";
  deltaCp: number | null;
  threat?: ThreatFacts;
  best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
  recommendation?: RecommendationFacts;
  // Derived below: every square/SAN token a narration is allowed to name.
  allowedSquares: string[];
  allowedSans: string[];
}

// A SAN like "Qh4#" almost never survives SAN_RE's trailing \b boundary
// intact in prose (the check/mate suffix sits between two non-word
// characters once followed by a space or the end of a sentence, so the
// regex backtracks off it) — see validate.ts's header comment. Both the
// full SAN and its suffix-stripped form are allowed so a narration that
// mentions a checking/mating move isn't spuriously flagged for a regex
// quirk rather than an actual fabrication.
function sanVariants(san: string | undefined): string[] {
  if (!san) return [];
  const stripped = san.replace(/[+#]+$/, "");
  return stripped === san ? [san] : [san, stripped];
}

// Pure: every field on the returned CoachFactList is copied straight from
// the caller-supplied structured facts (already derived by classify.ts /
// motifs.ts / hint.ts elsewhere) except allowedSquares/allowedSans, which
// are mechanically collected from the facts above them — nothing here ever
// invents a square or a move.
export function assembleFactList(input: {
  herMove: { pieceKind: string; from: string; to: string };
  tier: "nudge" | "warning";
  deltaCp: number | null;
  threat?: ThreatFacts;
  best?: { san: string; uci: string; pieceKind: string; from: string; to: string };
  recommendation?: RecommendationFacts;
}): CoachFactList {
  const squares = new Set<string>();
  squares.add(input.herMove.from);
  squares.add(input.herMove.to);

  if (input.threat) {
    squares.add(input.threat.refutationFromSquare);
    squares.add(input.threat.refutationToSquare);
    if (input.threat.capturesSquare) squares.add(input.threat.capturesSquare);
    for (const t of input.threat.forkTargets ?? []) squares.add(t.square);
  }
  if (input.best) {
    squares.add(input.best.from);
    squares.add(input.best.to);
  }
  if (input.recommendation) {
    squares.add(input.recommendation.fromSquare);
    squares.add(input.recommendation.toSquare);
    if (input.recommendation.capturesSquare) squares.add(input.recommendation.capturesSquare);
    if (input.recommendation.attackedSquare) squares.add(input.recommendation.attackedSquare);
    for (const t of input.recommendation.forkTargets ?? []) squares.add(t.square);
  }

  const sans = new Set<string>();
  for (const s of sanVariants(input.threat?.refutationSan)) sans.add(s);
  for (const s of sanVariants(input.best?.san)) sans.add(s);
  // F4 (increment 3a review fast-follow): recommendationVars below renders
  // {bestSan} from input.recommendation.san, not from input.best.san (the
  // two facts are assembled separately but the template variable name is
  // shared) — so a narration is only free to say that move's name when
  // best is ALSO present, unless recommendation.san is folded in here too.
  // A game state can carry recommendation without best (see the coach.md
  // "attacks"/"develops"/"gives-check" templates, none of which need a
  // capture-derived best move), so this is a real gap, not a redundant add.
  for (const s of sanVariants(input.recommendation?.san)) sans.add(s);
  // SAN_RE in validate.ts also matches a bare square (every piece/capture
  // prefix in that pattern is optional), so a legitimate plain-square
  // mention like "on d8" gets extracted a SECOND time as a SAN-shaped
  // token, not just once as a square token. Every allowed square is
  // therefore also an allowed "SAN": narrating with the square alone, with
  // no piece letter, is exactly as sanctioned as naming the full move.
  for (const s of squares) sans.add(s);

  return {
    ...input,
    allowedSquares: [...squares],
    allowedSans: [...sans],
  };
}

// ---- persona parsing (F14) -------------------------------------------

interface Persona {
  voice: string;
  systemPrompt: string;
  threatTemplates: Record<string, string>;
  recommendationTemplates: Record<string, string>;
  // F16 (chat, coach/chat.ts): a separate system prompt + template set,
  // parsed from the persona file's own "## chat" section below. Kept apart
  // from systemPrompt/threatTemplates/recommendationTemplates on purpose --
  // chat grounds against the whole game, not a single judged move's facts,
  // so it earns its own voice text and its own (single) fallback template
  // rather than overloading the narrate() shapes above.
  chatSystemPrompt: string;
  chatTemplates: Record<string, string>;
}

// No yaml dep: `## heading` splits the file into top-level sections,
// `### heading` further splits the templates section, and `- key: value`
// lines become the template map. Simple on purpose — the owner edits this
// file by hand.
function splitSections(md: string, marker: string): Record<string, string> {
  const out: Record<string, string> = {};
  let currentKey: string | null = null;
  let buf: string[] = [];
  for (const line of md.split("\n")) {
    if (line.startsWith(marker)) {
      if (currentKey) out[currentKey] = buf.join("\n");
      currentKey = line.slice(marker.length).trim().toLowerCase();
      buf = [];
    } else if (currentKey) {
      buf.push(line);
    }
  }
  if (currentKey) out[currentKey] = buf.join("\n");
  return out;
}

function parseTemplateList(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^-\s*([a-z-]+):\s*(.+)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function parsePersona(md: string): Persona {
  const top = splitSections(md, "## ");
  const templateBlock = top["templates"] ?? "";
  const sub = splitSections(templateBlock, "### ");
  // F16: "## chat" is a sibling top-level section with its own "### "
  // sub-split -- "### system prompt" and "### templates" here are scoped to
  // this block only, so they don't collide with the outer "## templates"
  // section's own "### threat"/"### recommendation" keys parsed above.
  const chatBlock = top["chat"] ?? "";
  const chatSub = splitSections(chatBlock, "### ");
  return {
    voice: (top["voice"] ?? "").trim(),
    systemPrompt: (top["system prompt"] ?? "").trim(),
    threatTemplates: parseTemplateList(sub["threat"] ?? ""),
    recommendationTemplates: parseTemplateList(sub["recommendation"] ?? ""),
    chatSystemPrompt: (chatSub["system prompt"] ?? "").trim(),
    chatTemplates: parseTemplateList(chatSub["templates"] ?? ""),
  };
}

let cachedPersona: Persona | null = null;

// Parsed once, cached: the owner can still edit the file (a process restart
// picks it up), but every narrate() call doesn't re-read + re-parse disk.
// Bugfix (increment 3a Wave 3 smoke): this package is ESM ("type": "module"
// in package.json), where __dirname doesn't exist — only vite-node's CJS
// compat shim (vitest's runner) papered over it, so every unit test passed
// while every real narrate() call under `tsx` crashed with "__dirname is
// not defined" before ever reaching the backend. import.meta.url is the
// ESM-native equivalent.
// Exported: server/coach/chat.ts (F16) reuses this same cached-persona
// accessor rather than re-reading/re-parsing personas/coach.md a second
// time -- one parse per process, shared by both narration surfaces.
export function getPersona(): Persona {
  if (!cachedPersona) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const md = fs.readFileSync(path.join(here, "personas/coach.md"), "utf-8");
    cachedPersona = parsePersona(md);
  }
  return cachedPersona;
}

// ---- template fallback --------------------------------------------------

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

// F2 (increment 3a review fast-follow): chess.js/motifs.ts piece kinds are
// single letters (p/n/b/r/q/k) — fine as internal identifiers, but the
// templates in personas/coach.md interpolate them straight into prose
// ("the r on d8"), which is not a word a kid learning chess should have to
// decode. This map is the only place that translation happens, so every
// {capturedPieceKind}/{attackedPieceKind}/future piece-kind placeholder
// renders a real word. Falls back to the raw kind for anything unmapped
// (defensive only — the letters above are the full chess.js piece-kind
// alphabet) rather than silently dropping it.
const PIECE_KIND_WORDS: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function pieceKindWord(kind: string | undefined): string {
  if (!kind) return "";
  return PIECE_KIND_WORDS[kind.toLowerCase()] ?? kind;
}

function threatVars(t: ThreatFacts): Record<string, string> {
  return {
    refutationSan: t.refutationSan,
    capturesSquare: t.capturesSquare ?? "",
    capturedPieceKind: pieceKindWord(t.capturedPieceKind),
    forkSquares: (t.forkTargets ?? []).map((x) => x.square).join(" and "),
  };
}

function recommendationVars(r: RecommendationFacts): Record<string, string> {
  return {
    bestSan: r.san,
    capturesSquare: r.capturesSquare ?? "",
    capturedPieceKind: pieceKindWord(r.capturedPieceKind),
    forkSquares: (r.forkTargets ?? []).map((x) => x.square).join(" and "),
    attackedSquare: r.attackedSquare ?? "",
    attackedPieceKind: pieceKindWord(r.attackedPieceKind),
  };
}

// Deterministic fallback (F17's third tier, and the systemic-failure floor
// for F18): built purely by substituting already-sanctioned fact-list
// values into the persona's template strings, so it trivially satisfies
// validateNarration by construction — no need to run it back through
// validation.
export function buildTemplateNarration(facts: CoachFactList, persona: Persona = getPersona()): string {
  const parts: string[] = [];

  if (facts.threat) {
    const template = persona.threatTemplates[facts.threat.motif];
    if (template) parts.push(fillTemplate(template, threatVars(facts.threat)));
  }
  if (facts.recommendation) {
    const template = persona.recommendationTemplates[facts.recommendation.accomplishment];
    if (template) parts.push(fillTemplate(template, recommendationVars(facts.recommendation)));
  }

  if (parts.length === 0) {
    return "nothing extra to flag this time, just keep playing your plan.";
  }
  return parts.join(" ");
}

// ---- narration loop (F17 + F18) -----------------------------------------

const NARRATE_TIMEOUT_MS = 15000;

function buildPrompt(facts: CoachFactList, persona: Persona): string {
  const factsForModel = {
    herMove: facts.herMove,
    tier: facts.tier,
    deltaCp: facts.deltaCp,
    threat: facts.threat,
    best: facts.best,
    recommendation: facts.recommendation,
  };
  return [
    persona.systemPrompt,
    "",
    "fact list (json):",
    JSON.stringify(factsForModel, null, 2),
  ].join("\n");
}

function correctiveSuffix(violations: string[]): string {
  return [
    "",
    "",
    `your previous answer mentioned ${violations.join(", ")}, which is not in the fact list above.`,
    "rewrite it using only squares and moves listed there, 2-3 short lowercase sentences, no em-dashes, no emojis.",
  ].join("\n");
}

// Trace context the caller (server/game/manager.ts's narrate method) is
// expected to supply so every narrate() call self-reports a row (F40:
// 100% completeness) regardless of who's calling it — the caller can never
// forget to trace.
export interface NarrateTraceContext {
  gameId: number;
  ply: number;
  kind: string;
}

export interface NarrateResult {
  text: string;
  source: NarrateSource;
  traceId: number;
  traceMeta: {
    backend: string;
    prompt: string;
    output: string;
    validated: boolean;
    regenCount: number;
    latencyMs: number;
  };
}

// narrate flow: build prompt -> backend.generate -> validate -> on
// violation (including empty output), ONE regeneration with a corrective
// suffix naming the violation -> on second violation or backend
// error/timeout, deterministic template narration. Never throws; always
// returns text. Writes exactly one advice_traces row per call (model or
// template) before returning.
export async function narrate(
  facts: CoachFactList,
  backend: CoachBackend,
  trace: NarrateTraceContext
): Promise<NarrateResult> {
  const start = Date.now();
  const persona = getPersona();
  const basePrompt = buildPrompt(facts, persona);

  let attemptPrompt = basePrompt;
  let attemptOutput = "";
  let regenCount = 0;
  let modelText: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      attemptOutput = await backend.generate(attemptPrompt, NARRATE_TIMEOUT_MS);
    } catch (err) {
      // Backend error/timeout at any attempt short-circuits straight to the
      // template fallback below — never worth a second network/process call.
      attemptOutput = `[backend error] ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    const trimmed = attemptOutput.trim();
    const result = trimmed.length > 0 ? validateNarration(attemptOutput, facts) : ({ ok: false, violations: [] } as const);
    if (result.ok) {
      modelText = trimmed;
      break;
    }
    if (attempt === 0) {
      regenCount = 1;
      const violations = "violations" in result && result.violations.length > 0 ? result.violations : ["the previous answer"];
      attemptPrompt = basePrompt + correctiveSuffix(violations);
    }
  }

  const source: NarrateSource = modelText !== null ? "model" : "template";
  const text = modelText ?? buildTemplateNarration(facts, persona);
  const latencyMs = Date.now() - start;

  const traceId = recordAdviceTrace({
    gameId: trace.gameId,
    ply: trace.ply,
    kind: trace.kind,
    facts,
    prompt: attemptPrompt,
    output: attemptOutput,
    source,
    backend: backend.name,
    validated: source === "model",
    regenCount,
    latencyMs,
  });

  return {
    text,
    source,
    traceId,
    traceMeta: {
      backend: backend.name,
      prompt: attemptPrompt,
      output: attemptOutput,
      validated: source === "model",
      regenCount,
      latencyMs,
    },
  };
}
