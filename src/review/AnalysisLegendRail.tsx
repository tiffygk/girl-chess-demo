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
// Density deviation from the mockup (verification-driven, not a redesign):
// the mockup's D1 lays the solid cluster out as a 2x2 grid, sized for its
// demo board's 520px-wide debrief column. The REAL .debrief is capped at
// `min(88vw, 380px)` (sugar-glitch.css) -- at that width a 2-column solid
// cluster overflowed the plate in the verification harness. Both clusters
// render as a single-column stack here instead; every porter's-numbers
// spec (swatch geometry, row height, gaps, type, chamfer, shadow) is
// unchanged, only the rows-within-cluster arrangement.
//
// Pure markup over analysisLegend.ts's row model; geometry below is the
// approved mockup's exact porter's-numbers spec (vault "3 visual/Girl
// Chess — Arrow Legend (mockup, 2026-07-28).html", D1), not re-derived:
// swatch 44x14, shaft x=3..35 y=7 stroke-width 2.5 round cap, dashed
// stroke-dasharray "5 3.5" (head stays solid), arrowhead tip (42,7) base
// (35, 7±4.2), found halo 5px cyan under-stroke + 2.5px cyan head outline
// beneath the green 2.5px layer, axis-header neutral-ink line sample
// 18x2.5.
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
  return (
    <div className="axis-head">
      <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true">
        <line
          x1="1"
          y1="2"
          x2="17"
          y2="2"
          stroke="#6952C4"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={dashed ? "5 3.5" : undefined}
        />
      </svg>
      <span className="word">{words}</span>
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
        <div className="cluster-divider" />
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
