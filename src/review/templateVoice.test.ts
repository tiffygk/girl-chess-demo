// Voice-align round (2026-09-08), V1 lint test: the recurrence check for
// the owner's "remove AIisms" ask (coach chat, hint ladder, post-game
// debriefs). Copies the source-scan shape of server/annotator/classify.
// test.ts:36-49 (fs.readFileSync + line scan + assert) rather than importing
// the modules and asserting on rendered output, so it catches a NEW banned
// literal anywhere in these files' string content, not just the ones this
// round already fixed.
//
// Scope: only string/template literal CONTENT in the .ts files (never raw
// source text, so a banned word sitting in a code comment -- there are
// plenty of "real" and "—" in dev comments across this codebase -- never
// trips it) plus every line of coach.md except its own deliberately-bad
// "- bad:" quote examples (those exist to demonstrate the tell; skipping
// them is the same discipline the brief calls out).
/// <reference types="node" />
// tsconfig.app.json scopes "types" to ["vite/client"] only (src/ is
// browser code), so this file -- alone under src/, needing fs/path/
// __dirname for a source-scan test -- pulls in @types/node's ambient
// declarations locally via the triple-slash reference above rather than
// widening the whole app tsconfig's global types.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const TS_FILES = [
  "src/game/hintFlow.ts",
  "src/review/debriefBullets.ts",
  "src/review/turningPointNote.ts",
  "src/review/debriefLesson.ts",
  "src/review/opportunity.ts",
];
const COACH_MD = "server/coach/personas/coach.md";

interface Pattern {
  name: string;
  re: RegExp;
}

// Case-insensitive, word-bounded where the brief marks it that way.
const FORBIDDEN_PATTERNS: Pattern[] = [
  { name: "em-dash", re: /—/ },
  { name: "en-dash", re: /–/ },
  { name: "spaced double-hyphen", re: / -- / },
  { name: "quietly", re: /\bquietly\b/i },
  {
    name: "real-as-booster",
    re: /\breal (slip|gift|ground|pressure|issue|reason|plan|mistake)\b/i,
  },
  { name: "worth-a-look/knowing/noting/rewind", re: /\bworth (a look|a rewind|knowing|noting)\b/i },
  { name: "not-x-its-y rhythm", re: /it['’]s not [^.]*, it['’]s/i },
  { name: "not just", re: /\bnot just\b/i },
  { name: "that's the thing", re: /\bthat['’]s the thing\b/i },
  { name: "here's the real", re: /\bhere['’]s the real\b/i },
  { name: "let's", re: /\blet['’]s\b/i },
  { name: "genuinely", re: /\bgenuinely\b/i },
  { name: "delve", re: /\bdelve\b/i },
  { name: "leverage", re: /\bleverage\b/i },
  { name: "robust", re: /\brobust\b/i },
  { name: "crucial", re: /\bcrucial\b/i },
  { name: "nuanced", re: /\bnuanced\b/i },
];

// coach.md deviation (noted in the wave report): the file's own descriptive
// prose (talking ABOUT the persona to the model -- "our chess brain hasn't
// worked that moment out yet", the jargon-avoidance paragraph, etc.) has
// long used " -- " as its house ASCII substitute for an em-dash, in 8
// places, none of them in this wave's V1/V2 tables and none of them
// player-facing copy. Rewriting those would violate "do not rewrite
// anything not in the table"; so coach.md is scanned with every pattern
// EXCEPT the spaced-double-hyphen one. The literal em-dash/en-dash
// characters stay banned everywhere (global-constraints.md's "no
// em-dashes... anywhere in copy"), and every other AI-ism pattern still
// applies to the whole file.
//
// Same deviation, one more pattern: "needed, not just whether the move was
// good." (system prompt, one pre-existing line) is ordinary contrastive
// English, not the AI-ism filler rhythm ("not just an X, but a Y") the
// pattern is meant to catch. It is the only "not just" in the file and
// isn't in this wave's tables, so "not just" is excluded for coach.md too
// and stays enforced on the .ts files, where it has zero current hits.
const COACH_MD_EXCLUDED = new Set(["spaced double-hyphen", "not just"]);
const COACH_MD_PATTERNS = FORBIDDEN_PATTERNS.filter((p) => !COACH_MD_EXCLUDED.has(p.name));

interface Literal {
  line: number; // 1-based
  text: string;
}

/**
 * Extracts the CONTENT of every "...", '...', and `...` literal in a .ts
 * source, ignoring everything inside `//` line comments and `/* *\/` block
 * comments (a naive per-line quote regex false-positives on comment prose
 * containing apostrophes, e.g. "can't prove -- mirrors the old X's fallback"
 * reads as a single-quoted string from "t prove..." to "...X's"). A small
 * character-by-character state machine avoids that without needing a real
 * TS parser.
 */
function extractTsLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    // Line comment.
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // Block comment.
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    // String / template literal.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      let j = i + 1;
      let buf = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") {
          buf += src[j] + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (src[j] === "\n") line++;
        buf += src[j];
        j++;
      }
      out.push({ line: startLine, text: buf });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Every line of coach.md, excluding the "## voice" section's own
 * deliberately-bad quote examples: a line trimmed-starting with "- bad:",
 * plus its continuation line when the bad quote's opening `"` isn't closed
 * on the same line (the bad/good pairs in this file are each exactly one or
 * two lines long).
 */
// The two banned-word/banned-shape paragraphs ("banned words. never use
// these..." and "more banned shapes. never use "real" as a booster...")
// necessarily NAME the forbidden tokens to define them, same as the "- bad:"
// quotes -- they're the tell on purpose, not a recurrence. Skipped as whole
// paragraphs (to the next blank line) rather than line-by-line, since the
// list wraps across several lines.
const PARAGRAPH_TELL_MARKERS = ["banned words.", "more banned shapes."];

function extractCoachMdLines(src: string): Literal[] {
  const out: Literal[] = [];
  const lines = src.split("\n");
  let skipNext = false; // "- bad:" quote continuation
  let skippingParagraph = false; // inside a banned-word/-shape definition paragraph
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const trimmed = raw.trim();
    if (skippingParagraph) {
      if (trimmed === "") {
        skippingParagraph = false;
        out.push({ line: lineNo, text: raw });
      }
      return;
    }
    if (skipNext) {
      skipNext = false;
      return;
    }
    if (PARAGRAPH_TELL_MARKERS.some((m) => trimmed.startsWith(m))) {
      skippingParagraph = true;
      return;
    }
    if (trimmed.startsWith("- bad:")) {
      const quoteCount = (raw.match(/"/g) ?? []).length;
      if (quoteCount % 2 === 1) skipNext = true;
      return;
    }
    out.push({ line: lineNo, text: raw });
  });
  return out;
}

describe("template voice lint -- no AI-ism recurrence in coach copy", () => {
  for (const file of TS_FILES) {
    it(`${file} has no banned string-literal content`, () => {
      const abs = path.join(__dirname, "..", "..", file);
      const src = fs.readFileSync(abs, "utf-8");
      const literals = extractTsLiterals(src);
      for (const { line, text } of literals) {
        for (const { name, re } of FORBIDDEN_PATTERNS) {
          expect(
            re.test(text),
            `${file}:${line} matched forbidden pattern "${name}" in literal: ${JSON.stringify(text)}`
          ).toBe(false);
        }
      }
    });
  }

  it(`${COACH_MD} has no banned copy outside its own bad-example quotes`, () => {
    const abs = path.join(__dirname, "..", "..", COACH_MD);
    const src = fs.readFileSync(abs, "utf-8");
    const scannable = extractCoachMdLines(src);
    for (const { line, text } of scannable) {
      for (const { name, re } of COACH_MD_PATTERNS) {
        expect(
          re.test(text),
          `${COACH_MD}:${line} matched forbidden pattern "${name}" in line: ${JSON.stringify(text)}`
        ).toBe(false);
      }
    }
  });
});
