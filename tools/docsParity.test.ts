import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

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

// Matches only image markdown syntax (the `!` prefix), never a plain link --
// needed once images live in a subfolder (docs/images/diagrams/) and are
// referenced from pages other than index.md, where a plain-link false match
// would let an orphan or a missing image slip past silently.
const IMAGE_TARGET_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

function imageTargets(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(IMAGE_TARGET_RE);
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

// Files docs/ parity checks must see the same way git and GitHub Pages see
// them: tracked-by-git, never a directory listing. readdirSync would also
// pick up untracked file-sync duplicates ("index 2.md") and ignored cruft
// (.DS_Store), neither of which is part of the published site, and fail the
// checks below over files that were never really there.
function gitTrackedUnder(subdir: string): string[] {
  const result = spawnSync("git", ["ls-files", subdir], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ls-files ${subdir} failed: ${result.stderr || String(result.error)}`);
  }
  return result.stdout.split("\n").filter((l) => l.length > 0);
}

// Direct children of docs/ only (not docs/images/**), as basenames -- the
// same set readdirSync(DOCS) used to return, sourced from git instead.
function docsTopLevelFiles(): string[] {
  return gitTrackedUnder("docs")
    .filter((p) => path.posix.dirname(p) === "docs")
    .map((p) => path.posix.basename(p));
}

function docsMdFiles(): string[] {
  return docsTopLevelFiles().filter((f) => f.endsWith(".md"));
}

function docsMdText(f: string): string {
  return fs.readFileSync(path.join(DOCS, f), "utf8");
}

// Every image file under docs/images/, recursively, as a path relative to
// docs/images/ (posix separators, so "diagrams/hint-ladder-rungs.svg").
function imageFilesRecursive(): string[] {
  return gitTrackedUnder("docs/images").map((p) => p.slice("docs/images/".length));
}

// Every image reference from every docs/*.md page, resolved to a path
// relative to docs/images/ (the "images/" prefix stripped), collected across
// the whole docs/ folder rather than just index.md.
function allImageRefsAcrossDocs(): Set<string> {
  const refs = new Set<string>();
  for (const f of docsMdFiles()) {
    for (const t of imageTargets(docsMdText(f))) {
      if (t.startsWith("images/")) refs.add(t.slice("images/".length));
    }
  }
  return refs;
}

describe("docs image parity", () => {
  it("every docs/images/*.png that README.md references is also referenced by docs/index.md", () => {
    const fromReadme = new Set(readmePngRefs());
    const fromIndex = new Set(indexPngRefs());
    for (const f of fromReadme) {
      expect(fromIndex.has(f), `docs/index.md is missing an image README.md references: ${f}`).toBe(true);
    }
  });

  it("every image file under docs/images/ (recursively) is referenced by at least one docs/*.md page", () => {
    const onDisk = new Set(imageFilesRecursive());
    const referenced = allImageRefsAcrossDocs();
    const orphans = [...onDisk].filter((f) => !referenced.has(f));
    expect(orphans, "image files on disk but not referenced by any docs/*.md page").toEqual([]);
  });

  it("every image reference in any docs/*.md resolves to a real file under docs/images/", () => {
    for (const f of docsMdFiles()) {
      for (const t of imageTargets(docsMdText(f))) {
        if (!t.startsWith("images/")) continue;
        const resolved = path.join(DOCS, t);
        expect(fs.existsSync(resolved), `${f} references an image that does not exist: ${t} (resolved ${resolved})`).toBe(true);
      }
    }
  });
});

describe("every docs/ page is linked from docs/index.md", () => {
  it("every .md file in docs/ (other than index.md) is linked by its relative path", () => {
    const index = indexText();
    const mdFiles = docsMdFiles().filter((f) => f !== "index.md");
    for (const f of mdFiles) {
      expect(index, `docs/index.md is missing a relative link to ${f}`).toContain(`(${f})`);
    }
  });

  it("every .html file in docs/ is linked by its full Pages URL", () => {
    const index = indexText();
    const htmlFiles = docsTopLevelFiles().filter((f) => f.endsWith(".html"));
    for (const f of htmlFiles) {
      expect(index, `docs/index.md is missing the full Pages URL for ${f}`).toContain(`${PAGES_BASE}${f}`);
    }
  });

  it("every entry in docs/ other than index.md and images/ is one of the .md or .html files just checked", () => {
    const entries = docsTopLevelFiles().filter((f) => f !== "index.md");
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

  it("every docs/*.md page's relative links and images all resolve, relative to docs/", () => {
    for (const f of docsMdFiles()) {
      for (const target of resolvableLocalTargets(docsMdText(f))) {
        const resolved = path.join(DOCS, target);
        expect(fs.existsSync(resolved), `docs/${f} links to a missing path: ${target} (resolved ${resolved})`).toBe(true);
      }
    }
  });
});
