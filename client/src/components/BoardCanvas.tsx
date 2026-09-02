import { useRef, useState } from 'react';
import type { Board, Point, Segment, Stroke } from '../../../shared/src/types';

const VIEW = 600; // SVG viewBox size; endpoints are normalized 0..1 and scaled to this.

/** Max distance (normalized) a raw point can be from a line and still snap. */
const SNAP_RADIUS = 0.12;
/** Minimum move (normalized) between captured points, to thin out the stream. */
const MIN_STEP = 0.008;

interface Props {
  board: Board;
  /** Committed strokes: free-drawn polylines already snapped to the board's lines. */
  value: Stroke[];
  editable: boolean;
  onChange?: (strokes: Stroke[]) => void;
}

/**
 * The "mind the lines" board.
 *
 * All dealt segments are drawn faint (the lines you must trace along). When
 * editable, the player draws FREELY with pointer/touch, but every point is
 * projected onto the nearest dealt segment before it's kept, so ink always lies
 * on the dealt lines. Points beyond SNAP_RADIUS from every line are ignored, so
 * you can lift between lines without leaving stray marks.
 */
export default function BoardCanvas({ board, value, editable, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<Point[] | null>(null); // stroke in progress
  const drawing = useRef(false);

  const px = (n: number) => n * VIEW;

  /** Convert a pointer event to normalized [0,1] board coordinates. */
  function toBoard(e: React.PointerEvent): Point {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  /** Nearest point on a dealt line (a polyline of sub-segments) to p, plus the
   * squared distance to it. */
  function projectToSegment(p: Point, s: Segment): { point: Point; d2: number } {
    let best: Point = s.points[0];
    let bestD2 = Infinity;
    for (let i = 0; i < s.points.length - 1; i++) {
      const a = s.points[i];
      const b = s.points[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const point = { x: a.x + abx * t, y: a.y + aby * t };
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = point;
      }
    }
    return { point: best, d2: bestD2 };
  }

  /** Snap a raw point to the closest dealt segment, or null if too far. */
  function snap(p: Point): Point | null {
    let best: Point | null = null;
    let bestD2 = SNAP_RADIUS * SNAP_RADIUS;
    for (const s of board.segments) {
      const { point, d2 } = projectToSegment(p, s);
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = point;
      }
    }
    return best;
  }

  function appendSnapped(raw: Point) {
    const snapped = snap(raw);
    if (!snapped) return;
    setLive((prev) => {
      if (!prev || prev.length === 0) return [snapped];
      const last = prev[prev.length - 1];
      const dx = snapped.x - last.x;
      const dy = snapped.y - last.y;
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return prev;
      return [...prev, snapped];
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!editable || !onChange) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    const snapped = snap(toBoard(e));
    setLive(snapped ? [snapped] : []);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    appendSnapped(toBoard(e));
  }

  function endStroke() {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = live;
    setLive(null);
    if (onChange && pts && pts.length >= 2) {
      onChange([...value, { points: pts }]);
    }
  }

  function clear() {
    if (!editable || !onChange) return;
    setLive(null);
    onChange([]);
  }

  function undo() {
    if (!editable || !onChange) return;
    onChange(value.slice(0, -1));
  }

  const toPolyPoints = (pts: Point[]) => pts.map((p) => `${px(p.x)},${px(p.y)}`).join(' ');

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
          <polyline
            key={`base-${seg.id}`}
            points={toPolyPoints(seg.points)}
            className="seg-base"
          />
        ))}

        {/* Committed ink strokes (free-drawn, snapped). */}
        {value.map((stroke, i) =>
          stroke.points.length >= 2 ? (
            <polyline key={`ink-${i}`} points={toPolyPoints(stroke.points)} className="seg-ink" />
          ) : null,
        )}

        {/* Stroke currently being drawn. */}
        {live && live.length >= 2 && (
          <polyline points={toPolyPoints(live)} className="seg-ink live" />
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
