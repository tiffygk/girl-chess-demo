// D1 "cipher rail" -- the six-state arrow legend, mounted as the first
// child of the debrief block (see DebriefPage.tsx). Analysis/review only:
// DebriefPage itself is never rendered during live play (see
// analysisLegend.test.ts's gating pins), so this component inherits that
// scoping for free -- no extra prop or condition needed here.
//
// File named AnalysisLegendRail.tsx (not AnalysisLegend.tsx) -- same
// macOS case-insensitive-filesystem dodge MoveListNav.tsx already
// documents: a component file differing from its pure-data module only by
// the first letter's case (AnalysisLegend.tsx vs analysisLegend.ts) makes
// TS module resolution pick the wrong file, which surfaced here as
// react-dom/server rendering `undefined` for this component in
// DebriefPage.test.tsx. The exported symbol stays `AnalysisLegend`.
//
// Round-3 rebuild (owner-approved mock, vault "3 visual/Girl Chess —
// Round 3 Repair (mockup, 2026-07-29).html", section 3): one column at
// EVERY width -- the two clusters need 417px inside a 380px plate and can
// never fit side by side, so the side-by-side body and its skewed divider
// are deleted, not media-queried (visual-rca 3). Axis heads are promoted
// to real headers with a full-width solid/dashed rule under the text
// (visual-rca 5); the old 18x2.5 line sample that read as a fifth arrow
// row is gone.
//
// Pure markup over analysisLegend.ts's row model; swatch geometry is the
// approved mock's exact porter's-numbers spec, unchanged from the
// 2026-07-28 port: swatch 44x14, shaft x=3..35 y=7 stroke-width 2.5 round
// cap, dashed stroke-dasharray "5 3.5" (head stays solid), arrowhead tip
// (42,7) base (35, 7±4.2), found halo 5px cyan under-stroke + 2.5px cyan
// head outline beneath the green 2.5px layer.
import { LEGEND_SOLID_ROWS, LEGEND_DASHED_ROWS, type LegendRow } from "./analysisLegend";

function LegendSwatch({ row }: { row: LegendRow }) {
  const dash = row.style === "dashed" ? "5 3.5" : undefined;
  return (
    <svg className="legend-swatch" width="44" height="14" viewBox="0 0 44 14" aria-hidden="true">
      {row.haloColor && (
        <>
          <line x1="3" y1="7" x2="35" y2="7" strokeWidth={5} strokeLinecap="round" stroke={row.haloColor} />
          <polygon
            points="42,7 35,2.8 35,11.2"
            fill={row.haloColor}
            stroke={row.haloColor}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        </>
      )}
      <line
        x1="3"
        y1="7"
        x2="35"
        y2="7"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={dash}
        stroke={row.color}
      />
      <polygon points="42,7 35,2.8 35,11.2" fill={row.color} />
    </svg>
  );
}

function LegendRowLine({ row }: { row: LegendRow }) {
  return (
    <div className="legend-row">
      <LegendSwatch row={row} />
      <span className="legend-label">{row.label}</span>
    </div>
  );
}

function AxisHead({ dashed, words }: { dashed: boolean; words: string }) {
  // Promoted to a real header (visual-rca 5): larger and darker than the
  // rows it heads (12px/700/#4A3B7E vs 10.5px/600/#6952C4), with a
  // full-width rule UNDER the text that keeps teaching solid-vs-dashed
  // without impersonating an arrow row (no arrowhead, no row scale).
  return (
    <div className="axis-head">
      <span className="word">{words}</span>
      <svg className="axis-rule" height="3" aria-hidden="true">
        <line x1="0" y1="1.5" x2="100%" y2="1.5" stroke="#4A3B7E" strokeWidth={2.5} strokeDasharray={dashed ? "5 3.5" : undefined} />
      </svg>
    </div>
  );
}

export function AnalysisLegend() {
  return (
    <div className="legend-rail">
      <span className="legend-kicker">analysis legend</span>
      <div className="rail-body">
        <div className="cluster-inner">
          <AxisHead dashed={false} words="solid: it happened" />
          <div className="cluster-rows stack">
            {LEGEND_SOLID_ROWS.map((row) => (
              <LegendRowLine row={row} key={row.kind} />
            ))}
          </div>
        </div>
        <div className="cluster-inner">
          <AxisHead dashed={true} words="dashed: it didn't" />
          <div className="cluster-rows stack">
            {LEGEND_DASHED_ROWS.map((row) => (
              <LegendRowLine row={row} key={row.kind} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
