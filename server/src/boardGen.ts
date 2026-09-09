import type { Board, Point, Segment } from '../../shared/src/types';

/** Deterministic 32-bit PRNG. Returns a function producing floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an arbitrary string seed into a 32-bit unsigned integer (FNV-1a). */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ----------------------------------------------------------------------------
// Curve helpers
// ----------------------------------------------------------------------------


/** Catmull-Rom spline through the control points, sampled into a dense polyline
 * so both snapping and rendering can treat the curve as a series of tiny
 * straight sub-segments. Endpoints are duplicated so the curve passes through
 * the first and last control point. */
function sampleCurve(control: Point[], perSpan = 10): Point[] {
  if (control.length < 3) return control.slice();
  const pts = [control[0], ...control, control[control.length - 1]];
  const out: Point[] = [];
  for (let i = 0; i < pts.length - 3; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const p2 = pts[i + 2];
    const p3 = pts[i + 3];
    for (let j = 0; j < perSpan; j++) {
      const t = j / perSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x: clamp01(x), y: clamp01(y) });
    }
  }
  out.push(control[control.length - 1]);
  return out;
}

/** Build one wandering line of BOUNDED length. A line no longer spans the whole
 * board edge-to-edge; instead it starts at a random point, heads off in a random
 * direction for a modest distance, and drifts through a few jittered waypoints so
 * it curves aimlessly. The overall extent is capped (~20-45% of the board) so the
 * dealt segments read as short strokes rather than board-crossing lines. */
function wanderingLine(rand: () => number): Point[] {
  // Target span as a fraction of the board (short strokes, not full crossings).
  const span = 0.2 + rand() * 0.25;
  // Random start anywhere on the board, kept inside a margin so the line has
  // room to wander without immediately clamping against an edge.
  const margin = 0.08;
  const start: Point = {
    x: margin + rand() * (1 - 2 * margin),
    y: margin + rand() * (1 - 2 * margin),
  };
  // Random heading; end point is `span` away in that direction.
  const angle = rand() * Math.PI * 2;
  const end: Point = {
    x: clamp01(start.x + Math.cos(angle) * span),
    y: clamp01(start.y + Math.sin(angle) * span),
  };

  // 1-3 interior waypoints along the start->end line, pushed sideways so the
  // path wanders instead of running straight.
  const waypoints = 1 + Math.floor(rand() * 3);
  const control: Point[] = [start];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal to the start->end direction, to offset waypoints sideways.
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i <= waypoints; i++) {
    const t = i / (waypoints + 1);
    const baseX = start.x + dx * t;
    const baseY = start.y + dy * t;
    // Sideways drift proportional to the (short) span, so the wander scales with
    // the stroke rather than swinging across the whole board.
    const off = (rand() - 0.5) * span * 0.9;
    const along = (rand() - 0.5) * span * 0.2;
    control.push({
      x: clamp01(baseX + nx * off + (dx / len) * along),
      y: clamp01(baseY + ny * off + (dy / len) * along),
    });
  }
  control.push(end);
  return sampleCurve(control);
}

/**
 * Generate a deterministic set of traceable lines scattered across the board.
 *
 * Each line is a short, wandering curve (roughly 20-45% of the board across):
 *  1. Starts at a random interior point and heads off in a random direction for
 *     a bounded distance, so it reads as a stroke rather than a board crossing.
 *  2. Drifts through a few sideways-jittered waypoints and is rendered as a
 *     smooth Catmull-Rom curve, so it wanders rather than running straight.
 *  3. Is chosen by coverage-aware rejection sampling: several candidates are
 *     generated per line and the one that best fills currently-empty regions of
 *     the board wins, so the short lines still spread out and don't clump.
 *
 * Each line is stored as a dense polyline of normalized [0,1] points.
 */
const GRID = 4; // board split into GRID x GRID cells for coverage tracking

/** Which grid cells this polyline passes through. */
function cellsCovered(points: Point[]): Set<number> {
  const cells = new Set<number>();
  for (const p of points) {
    const cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    cells.add(cy * GRID + cx);
  }
  return cells;
}

export function generateBoard(seed: string, segmentCount: number): Board {
  const rand = mulberry32(hashSeed(seed));
  const target = Math.max(1, Math.floor(segmentCount));

  const segments: Segment[] = [];
  const seen = new Set<string>();
  // De-dupe on the rounded start+end so near-identical lines don't stack up.
  const key = (pts: Point[]) => {
    const q = (p: Point) => `${Math.round(p.x * 20)},${Math.round(p.y * 20)}`;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const [k1, k2] = [q(a), q(b)].sort();
    return `${k1}|${k2}`;
  };

  // Coverage count per cell; a candidate's score rewards touching empty cells.
  const coverage = new Array(GRID * GRID).fill(0);

  let guard = 0;
  while (segments.length < target && guard++ < target * 40) {
    // Sample a handful of candidate lines and keep the one that best fills the
    // least-covered cells, so the board stays evenly filled with no dead space.
    let best: { points: Point[]; k: string; cells: Set<number> } | null = null;
    let bestScore = -Infinity;
    for (let c = 0; c < 6; c++) {
      const points = wanderingLine(rand);
      const k = key(points);
      if (seen.has(k)) continue;
      const cells = cellsCovered(points);
      // Score: heavily reward untouched cells, mildly reward lightly-covered
      // ones, so early lines spread out and later lines patch the gaps.
      let score = 0;
      for (const cell of cells) score += 1 / (1 + coverage[cell] * 3);
      if (score > bestScore) {
        bestScore = score;
        best = { points, k, cells };
      }
    }
    if (!best) continue;
    seen.add(best.k);
    for (const cell of best.cells) coverage[cell]++;
    segments.push({ id: `${seed}:s${segments.length}`, points: best.points });
  }

  return { seed, segments };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
