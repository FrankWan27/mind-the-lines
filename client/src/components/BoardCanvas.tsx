import { useRef, useState } from 'react';
import type { Board, Point, Segment, Stroke } from '../../../shared/src/types';

const VIEW = 600; // SVG viewBox size; endpoints are normalized 0..1 and scaled to this.

/** Default brush radius (normalized): a point on a dealt line within this
 * distance of the pointer gets coloured in. Small, so only the bit under the
 * cursor fills. Adjustable at runtime via the slider. */
const DEFAULT_BRUSH = 0.028;
const MIN_BRUSH = 0.012;
const MAX_BRUSH = 0.06;
/** Minimum move (normalized) between processed pointer samples, to thin the
 * stream. Kept below the brush radius so swept circles overlap without gaps. */
const MIN_STEP = 0.004;

interface Props {
  board: Board;
  /** Committed strokes: polylines that lie ON the dealt curves. */
  value: Stroke[];
  editable: boolean;
  onChange?: (strokes: Stroke[]) => void;
}

/**
 * The "mind the lines" board.
 *
 * Dealt lines are wandering curves, each a dense polyline of points. When
 * editable the player "colours in" the lines: we treat the pointer as a small
 * round brush and, for every dealt curve, fill in exactly the vertices that
 * fall inside the brush circle. There is no line-following or tracing — ink
 * appears only where the brush actually overlapped a line, so it can never
 * bridge across empty space and never runs ahead of the finger.
 *
 * Coverage is tracked per dealt vertex (a boolean per segment vertex) and is
 * order-independent: painting the same spot twice is idempotent, and lifting or
 * jumping the pointer just leaves the already-coloured runs in place. On commit
 * each maximal run of coloured vertices on a segment becomes one ink polyline.
 *
 * The brush radius is shown to the player as a ring that follows the cursor,
 * and is adjustable with the pen-size slider.
 */
export default function BoardCanvas({ board, value, editable, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Per-segment coverage for the CURRENT gesture: covered[si][vi] = painted.
  const covered = useRef<boolean[][]>([]);
  // Bump to re-render as coverage changes mid-gesture (refs don't trigger it).
  const [tick, setTick] = useState(0);
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  // Cursor position (normalized) for the pen-size ring, or null when off-board.
  const [hover, setHover] = useState<Point | null>(null);
  const drawing = useRef(false);
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

  function freshCoverage(): boolean[][] {
    return board.segments.map((s) => new Array<boolean>(s.points.length).fill(false));
  }

  /** Paint: mark every dealt-curve vertex within the brush radius of the pointer. */
  function paintAt(p: Point) {
    const r2 = brush * brush;
    const cov = covered.current;
    let changed = false;
    board.segments.forEach((s: Segment, si) => {
      const row = cov[si];
      for (let vi = 0; vi < s.points.length; vi++) {
        if (row[vi]) continue;
        const q = s.points[vi];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        if (dx * dx + dy * dy <= r2) {
          row[vi] = true;
          changed = true;
        }
      }
    });
    if (changed) setTick((t) => t + 1);
  }

  /** Fold the current coverage into ink polylines: each maximal run of covered
   * vertices on a segment is one stroke (>= 2 points to be visible). */
  function coverageToStrokes(): Stroke[] {
    const out: Stroke[] = [];
    board.segments.forEach((s: Segment, si) => {
      const row = covered.current[si];
      if (!row) return;
      let run: Point[] = [];
      const flush = () => {
        if (run.length >= 2) out.push({ points: run });
        run = [];
      };
      for (let vi = 0; vi < s.points.length; vi++) {
        if (row[vi]) run.push({ ...s.points[vi] });
        else flush();
      }
      flush();
    });
    return out;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!editable || !onChange) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    covered.current = freshCoverage();
    lastRaw.current = toBoard(e);
    setHover(lastRaw.current);
    paintAt(lastRaw.current);
  }

  function onPointerMove(e: React.PointerEvent) {
    const raw = toBoard(e);
    if (editable) setHover(raw);
    if (!drawing.current) return;
    e.preventDefault();
    const lr = lastRaw.current;
    if (lr) {
      const dx = raw.x - lr.x;
      const dy = raw.y - lr.y;
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return;
    }
    lastRaw.current = raw;
    paintAt(raw);
  }

  function endStroke() {
    if (!drawing.current) return;
    drawing.current = false;
    lastRaw.current = null;
    const committed = coverageToStrokes();
    covered.current = [];
    setTick((t) => t + 1);
    if (onChange && committed.length) onChange([...value, ...committed]);
  }

  function onPointerLeave() {
    setHover(null);
    endStroke();
  }

  function clear() {
    if (!editable || !onChange) return;
    covered.current = [];
    setTick((t) => t + 1);
    onChange([]);
  }

  function undo() {
    if (!editable || !onChange) return;
    onChange(value.slice(0, -1));
  }

  // Live ink for the in-progress gesture (recomputed each render via tick).
  void tick;
  const liveStrokes = drawing.current ? coverageToStrokes() : [];

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
        onPointerLeave={onPointerLeave}
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

        {/* Coloured-in runs for the in-progress gesture. */}
        {liveStrokes.map((ss, i) =>
          ss.points.length >= 2 ? (
            <polyline key={`live-${i}`} points={toPolyPoints(ss.points)} className="seg-ink live" />
          ) : null,
        )}

        {/* Pen-size ring: shows the brush radius under the cursor. */}
        {editable && hover && (
          <circle
            cx={px(hover.x)}
            cy={px(hover.y)}
            r={px(brush)}
            className="brush-ring"
          />
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
          <label className="pen-size">
            <span>Pen size</span>
            <input
              type="range"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              step={0.002}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
              aria-label="Pen size"
            />
          </label>
          <span className="board-hint">Colour in the lines — drag the brush over them</span>
        </div>
      )}
    </div>
  );
}
