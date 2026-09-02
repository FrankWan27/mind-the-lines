import { useRef, useState } from 'react';
import type { Board, Point, Segment, Stroke } from '../../../shared/src/types';

const VIEW = 600; // SVG viewBox size; endpoints are normalized 0..1 and scaled to this.

/** Max distance (normalized) a raw point can be from a line and still snap. */
const SNAP_RADIUS = 0.06;
/** Minimum move (normalized) between captured raw points, to thin the stream. */
const MIN_STEP = 0.006;

interface Props {
  board: Board;
  /** Committed strokes: polylines that lie ON the dealt curves (snapped). */
  value: Stroke[];
  editable: boolean;
  onChange?: (strokes: Stroke[]) => void;
}

/** Nearest dealt-curve vertex to a raw point: which line, which vertex, dist². */
interface Hit {
  seg: number; // index into board.segments
  vertex: number; // index into that segment's points
  d2: number;
}

/**
 * The "mind the lines" board.
 *
 * Dealt lines are wandering curves, each a dense polyline of points. When
 * editable the player draws FREELY, but the ink is constrained to lie ON those
 * curves: for each raw pointer sample we find the nearest curve vertex and emit
 * the curve's ACTUAL vertices walked between the last position and the new one.
 * So ink always follows a real line and never bridges straight across empty
 * space. The stroke breaks (starts a new sub-stroke) when the pointer leaves
 * every line or jumps to a different line, so lifting between lines leaves no
 * stray marks.
 */
export default function BoardCanvas({ board, value, editable, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Sub-strokes traced so far in the current gesture (each lies on one curve).
  const [live, setLive] = useState<Point[][]>([]);
  const drawing = useRef(false);
  // Where we currently are on the dealt graph: which line + vertex, or null.
  const cursor = useRef<{ seg: number; vertex: number } | null>(null);
  const lastRaw = useRef<Point | null>(null);

  const px = (n: number) => n * VIEW;
  const toPolyPoints = (pts: Point[]) => pts.map((p) => `${px(p.x)},${px(p.y)}`).join(' ');

  /** Convert a pointer event to normalized [0,1] board coordinates. */
  function toBoard(e: React.PointerEvent): Point {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  /** Nearest dealt-curve vertex to p within SNAP_RADIUS, or null if too far. */
  function nearestVertex(p: Point): Hit | null {
    let best: Hit | null = null;
    let bestD2 = SNAP_RADIUS * SNAP_RADIUS;
    board.segments.forEach((s: Segment, si) => {
      for (let vi = 0; vi < s.points.length; vi++) {
        const q = s.points[vi];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = { seg: si, vertex: vi, d2 };
        }
      }
    });
    return best;
  }

  /** Advance the trace given a fresh raw pointer sample. */
  function extend(raw: Point) {
    const hit = nearestVertex(raw);
    setLive((prev) => {
      // Left every line: end the current sub-stroke, wait to re-enter.
      if (!hit) {
        cursor.current = null;
        return prev;
      }
      const cur = cursor.current;
      const pts = board.segments[hit.seg].points;
      // New sub-stroke: entered a line fresh, or jumped to a different line.
      if (!cur || cur.seg !== hit.seg) {
        cursor.current = { seg: hit.seg, vertex: hit.vertex };
        return [...prev, [{ ...pts[hit.vertex] }]];
      }
      // Same line: walk the curve's real vertices from last index to this one.
      const added: Point[] = [];
      const step = hit.vertex >= cur.vertex ? 1 : -1;
      for (let k = cur.vertex + step; k !== hit.vertex + step; k += step) {
        added.push({ ...pts[k] });
      }
      cursor.current = { seg: hit.seg, vertex: hit.vertex };
      if (added.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = [...next[next.length - 1], ...added];
      return next;
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!editable || !onChange) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    cursor.current = null;
    lastRaw.current = toBoard(e);
    setLive([]);
    extend(lastRaw.current);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const raw = toBoard(e);
    const lr = lastRaw.current;
    if (lr) {
      const dx = raw.x - lr.x;
      const dy = raw.y - lr.y;
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return;
    }
    lastRaw.current = raw;
    extend(raw);
  }

  function endStroke() {
    if (!drawing.current) return;
    drawing.current = false;
    cursor.current = null;
    lastRaw.current = null;
    setLive((liveNow) => {
      if (onChange) {
        const committed: Stroke[] = liveNow
          .filter((ss) => ss.length >= 2)
          .map((ss) => ({ points: ss }));
        if (committed.length) onChange([...value, ...committed]);
      }
      return [];
    });
  }

  function clear() {
    if (!editable || !onChange) return;
    setLive([]);
    onChange([]);
  }

  function undo() {
    if (!editable || !onChange) return;
    onChange(value.slice(0, -1));
  }

  return (
    <div className="board-canvas">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className={`board-svg ${editable ? 'editable' : ''}`}
        role="img"
        aria-label="Line board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      >
        <rect x={0} y={0} width={VIEW} height={VIEW} className="board-bg" rx={12} />

        {/* Faint dealt curves (the lines to mind). */}
        {board.segments.map((seg) => (
          <polyline key={`base-${seg.id}`} points={toPolyPoints(seg.points)} className="seg-base" />
        ))}

        {/* Committed ink strokes (each lies on a dealt curve). */}
        {value.map((stroke, i) =>
          stroke.points.length >= 2 ? (
            <polyline key={`ink-${i}`} points={toPolyPoints(stroke.points)} className="seg-ink" />
          ) : null,
        )}

        {/* Sub-strokes currently being drawn. */}
        {live.map((ss, i) =>
          ss.length >= 2 ? (
            <polyline key={`live-${i}`} points={toPolyPoints(ss)} className="seg-ink live" />
          ) : null,
        )}
      </svg>

      {editable && (
        <div className="board-tools">
          <button type="button" className="btn ghost" onClick={undo} disabled={value.length === 0}>
            Undo
          </button>
          <button type="button" className="btn ghost" onClick={clear} disabled={value.length === 0}>
            Clear
          </button>
          <span className="board-hint">Draw freely — your ink snaps to the nearest line</span>
        </div>
      )}
    </div>
  );
}
