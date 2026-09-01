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

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// The four board edges. A spanning line picks two DIFFERENT edges and drops a
// point on each, so it enters one side and exits another crossing the board.
type Edge = 'top' | 'bottom' | 'left' | 'right';
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];

/** A random point along the given edge, inset from the corners a touch. */
function pointOnEdge(edge: Edge, rand: () => number): Point {
  const t = 0.05 + rand() * 0.9; // stay off the exact corners
  switch (edge) {
    case 'top':
      return { x: t, y: 0 };
    case 'bottom':
      return { x: t, y: 1 };
    case 'left':
      return { x: 0, y: t };
    case 'right':
      return { x: 1, y: t };
  }
}

/**
 * Generate a deterministic set of traceable lines that SPAN the board.
 *
 * The physical game's boards are full of long lines that cross the whole card,
 * not a cluster of short local links. So here most lines go edge-to-edge:
 *  1. Pick two different edges (e.g. left -> right, top -> bottom, left -> top)
 *     and connect a random point on each. This guarantees the line traverses
 *     the board.
 *  2. Mix in a smaller share of long interior chords for variety, each forced
 *     to be at least ~60% of the board wide so nothing is a stub.
 *
 * All endpoints are normalized into [0, 1].
 */
export function generateBoard(seed: string, segmentCount: number): Board {
  const rand = mulberry32(hashSeed(seed));
  const target = Math.max(1, Math.floor(segmentCount));

  const segments: Segment[] = [];
  const seen = new Set<string>();
  // Round endpoints when de-duping so near-identical lines don't stack up.
  const key = (a: Point, b: Point) => {
    const q = (p: Point) => `${Math.round(p.x * 40)},${Math.round(p.y * 40)}`;
    const [k1, k2] = [q(a), q(b)].sort();
    return `${k1}|${k2}`;
  };

  // ~75% edge-to-edge spanning lines, the rest long interior chords.
  const spanTarget = Math.round(target * 0.75);

  let guard = 0;
  while (segments.length < target && guard++ < target * 40) {
    let a: Point;
    let b: Point;

    if (segments.length < spanTarget) {
      // Edge-to-edge: two distinct edges.
      const e1 = EDGES[Math.floor(rand() * EDGES.length)];
      let e2 = EDGES[Math.floor(rand() * EDGES.length)];
      if (e2 === e1) e2 = EDGES[(EDGES.indexOf(e1) + 1 + Math.floor(rand() * 3)) % EDGES.length];
      a = pointOnEdge(e1, rand);
      b = pointOnEdge(e2, rand);
    } else {
      // Long interior chord: random points, rejected unless they span >= 60%.
      a = { x: clamp01(0.04 + rand() * 0.92), y: clamp01(0.04 + rand() * 0.92) };
      b = { x: clamp01(0.04 + rand() * 0.92), y: clamp01(0.04 + rand() * 0.92) };
      if (dist(a, b) < 0.6) continue;
    }

    const k = key(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    segments.push({ id: `${seed}:s${segments.length}`, a, b });
  }

  return { seed, segments };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
