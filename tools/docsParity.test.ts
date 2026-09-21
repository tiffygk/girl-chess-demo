import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Parity checks between README.md, docs/index.md, and the docs/ folder's
// actual contents. No markdown parser: same string-assertion style as
// tools/claudeMdBudget.test.ts, on purpose, so a future reader can follow
// the checks without learning a new dependency.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const PAGES_BASE = "https://tiffygk.github.io/girl-chess-demo/";

const readmeText = () => fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const indexText = () => fs.readFileSync(path.join(DOCS, "index.md"), "utf8");

// Matches markdown link/image targets: ](target) -- covers both [text](target)
// and ![alt](target), since the image form is a strict superset of the pattern.
const LINK_TARGET_RE = /\]\(([^)]+)\)/g;

function linkTargets(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(LINK_TARGET_RE);
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function readmePngRefs(): string[] {
  // README.md images point at docs/images/<file>.png
  return linkTargets(readmeText())
    .filter((t) => t.startsWith("docs/images/") && t.endsWith(".png"))
    .map((t) => t.slice("docs/images/".length));
}

function indexPngRefs(): string[] {
  // docs/index.md images point at images/<file>.png (relative to docs/)
  return linkTargets(indexText())
    .filter((t) => t.startsWith("images/") && t.endsWith(".png"))
    .map((t) => t.slice("images/".length));
}

function pngFilesOnDisk(): string[] {
  return fs.readdirSync(path.join(DOCS, "images")).filter((f) => f.endsWith(".png"));
}

describe("docs image parity", () => {
  it("every docs/images/*.png that README.md references is also referenced by docs/index.md", () => {
    const fromReadme = new Set(readmePngRefs());
    const fromIndex = new Set(indexPngRefs());
    for (const f of fromReadme) {
      expect(fromIndex.has(f), `docs/index.md is missing an image README.md references: ${f}`).toBe(true);
    }
  });

  it("the set of files in docs/images/ equals the set referenced by docs/index.md (no orphans, no missing)", () => {
    const onDisk = new Set(pngFilesOnDisk());
    const fromIndex = new Set(indexPngRefs());
    const orphans = [...onDisk].filter((f) => !fromIndex.has(f));
    const missing = [...fromIndex].filter((f) => !onDisk.has(f));
    expect(orphans, "png files on disk but not referenced by docs/index.md").toEqual([]);
    expect(missing, "docs/index.md references a png that does not exist on disk").toEqual([]);
  });
});

describe("every docs/ page is linked from docs/index.md", () => {
  it("every .md file in docs/ (other than index.md) is linked by its relative path", () => {
    const index = indexText();
    const mdFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith(".md") && f !== "index.md");
    for (const f of mdFiles) {
      expect(index, `docs/index.md is missing a relative link to ${f}`).toContain(`(${f})`);
    }
  });

  it("every .html file in docs/ is linked by its full Pages URL", () => {
    const index = indexText();
    const htmlFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith(".html"));
    for (const f of htmlFiles) {
      expect(index, `docs/index.md is missing the full Pages URL for ${f}`).toContain(`${PAGES_BASE}${f}`);
    }
  });

  it("every entry in docs/ other than index.md and images/ is one of the .md or .html files just checked", () => {
    const entries = fs.readdirSync(DOCS).filter((f) => f !== "index.md" && f !== "images");
    for (const f of entries) {
      expect(f.endsWith(".md") || f.endsWith(".html"), `unexpected docs/ entry not covered by parity checks: ${f}`).toBe(true);
    }
  });
});

function stripAnchor(target: string): string {
  const hash = target.indexOf("#");
  return hash === -1 ? target : target.slice(0, hash);
}

function resolvableLocalTargets(text: string): string[] {
  return linkTargets(text)
    .map(stripAnchor)
    .filter((t) => t.length > 0 && !t.startsWith("http://") && !t.startsWith("https://"));
}

describe("every relative link and image path resolves to a real file", () => {
  it("README.md's relative links and images all resolve, relative to the repo root", () => {
    for (const target of resolvableLocalTargets(readmeText())) {
      const resolved = path.join(ROOT, target);
      expect(fs.existsSync(resolved), `README.md links to a missing path: ${target} (resolved ${resolved})`).toBe(true);
    }
  });

  it("docs/index.md's relative links and images all resolve, relative to docs/", () => {
    for (const target of resolvableLocalTargets(indexText())) {
      const resolved = path.join(DOCS, target);
      expect(fs.existsSync(resolved), `docs/index.md links to a missing path: ${target} (resolved ${resolved})`).toBe(true);
    }
  });
});
