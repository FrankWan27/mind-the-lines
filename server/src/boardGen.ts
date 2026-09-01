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

/**
 * Generate a deterministic "tangle" of traceable line segments.
 *
 * Approach:
 *  1. Scatter nodes on a jittered grid so points are spread but irregular.
 *  2. Connect each node to a few of its nearest neighbours, producing a
 *     connected-ish web of segments.
 *  3. De-duplicate reciprocal edges and cap at `segmentCount`.
 *
 * All endpoints are normalized into [0, 1].
 */
export function generateBoard(seed: string, segmentCount: number): Board {
  const rand = mulberry32(hashSeed(seed));
  const target = Math.max(1, Math.floor(segmentCount));

  // Choose a grid roughly proportional to the requested segment count so the
  // board fills the canvas at any size. Each cell hosts one jittered node.
  const nodeCount = Math.max(4, Math.round(target * 0.9));
  const cols = Math.max(2, Math.ceil(Math.sqrt(nodeCount)));
  const rows = Math.max(2, Math.ceil(nodeCount / cols));

  const nodes: Point[] = [];
  const margin = 0.06;
  const usable = 1 - margin * 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (nodes.length >= nodeCount) break;
      const cellW = usable / cols;
      const cellH = usable / rows;
      // Jitter within ~70% of the cell so nodes never overlap the grid lines.
      const jx = (rand() - 0.5) * cellW * 0.7;
      const jy = (rand() - 0.5) * cellH * 0.7;
      const x = margin + cellW * (c + 0.5) + jx;
      const y = margin + cellH * (r + 0.5) + jy;
      nodes.push({ x: clamp01(x), y: clamp01(y) });
    }
  }

  // Build candidate edges: connect each node to its 2-3 nearest neighbours.
  const seen = new Set<string>();
  const segments: Segment[] = [];
  const edgeKey = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);

  const order = shuffledIndices(nodes.length, rand);
  outer: for (const i of order) {
    const neighbours = nodes
      .map((p, j) => ({ j, d: dist(nodes[i], p) }))
      .filter((n) => n.j !== i)
      .sort((a, b) => a.d - b.d);

    const linksPerNode = 2 + Math.floor(rand() * 2); // 2 or 3
    for (let k = 0; k < Math.min(linksPerNode, neighbours.length); k++) {
      const j = neighbours[k].j;
      const key = edgeKey(i, j);
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push({
        id: `${seed}:s${segments.length}`,
        a: nodes[i],
        b: nodes[j],
      });
      if (segments.length >= target) break outer;
    }
  }

  // If we still fall short (small boards), add random long connectors.
  let guard = 0;
  while (segments.length < target && guard++ < target * 8) {
    const i = Math.floor(rand() * nodes.length);
    const j = Math.floor(rand() * nodes.length);
    if (i === j) continue;
    const key = edgeKey(i, j);
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({ id: `${seed}:s${segments.length}`, a: nodes[i], b: nodes[j] });
  }

  return { seed, segments };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function shuffledIndices(n: number, rand: () => number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
