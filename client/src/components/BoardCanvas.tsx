import { useMemo } from 'react';
import type { Board, Stroke } from '../../../shared/src/types';

const VIEW = 600; // SVG viewBox size; endpoints are normalized 0..1 and scaled to this.

interface Props {
  board: Board;
  /** Current committed value. A single Stroke of selected segmentIds is the simple model. */
  value: Stroke[];
  editable: boolean;
  onChange?: (strokes: Stroke[]) => void;
}

/**
 * The "mind the lines" board.
 *
 * All dealt segments are drawn faint + dashed (the lines you must trace along).
 * When editable, clicking a segment toggles it into a single ink stroke; traced
 * segments render bold/solid. Hit-testing is done by overlaying each segment with
 * a fat transparent line so thin segments are still easy to tap.
 *
 * We flatten every stroke's segmentIds into one selected set. On toggle we emit a
 * single Stroke containing the selected ids (order = board order, which is stable
 * and re-derivable on both ends).
 */
export default function BoardCanvas({ board, value, editable, onChange }: Props) {
  const selected = useMemo(() => {
    const s = new Set<string>();
    for (const stroke of value) for (const id of stroke.segmentIds) s.add(id);
    return s;
  }, [value]);

  function toggle(id: string) {
    if (!editable || !onChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Preserve board order for a deterministic, re-derivable polyline.
    const ids = board.segments.filter((seg) => next.has(seg.id)).map((seg) => seg.id);
    onChange(ids.length ? [{ segmentIds: ids }] : []);
  }

  function clear() {
    if (!editable || !onChange) return;
    onChange([]);
  }

  const px = (n: number) => n * VIEW;

  return (
    <div className="board-canvas">
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className={`board-svg ${editable ? 'editable' : ''}`}
        role="img"
        aria-label="Line board"
      >
        <rect x={0} y={0} width={VIEW} height={VIEW} className="board-bg" rx={12} />

        {/* Faint dealt segments (the lines to mind). */}
        {board.segments.map((seg) => (
          <line
            key={`base-${seg.id}`}
            x1={px(seg.a.x)}
            y1={px(seg.a.y)}
            x2={px(seg.b.x)}
            y2={px(seg.b.y)}
            className="seg-base"
          />
        ))}

        {/* Traced segments rendered bold on top. */}
        {board.segments
          .filter((seg) => selected.has(seg.id))
          .map((seg) => (
            <line
              key={`ink-${seg.id}`}
              x1={px(seg.a.x)}
              y1={px(seg.a.y)}
              x2={px(seg.b.x)}
              y2={px(seg.b.y)}
              className="seg-ink"
            />
          ))}

        {/* Endpoint dots for the dealt graph. */}
        {board.segments.map((seg) => (
          <g key={`dots-${seg.id}`}>
            <circle cx={px(seg.a.x)} cy={px(seg.a.y)} r={4} className="seg-node" />
            <circle cx={px(seg.b.x)} cy={px(seg.b.y)} r={4} className="seg-node" />
          </g>
        ))}

        {/* Fat invisible hit targets on top for easy clicking (editable only). */}
        {editable &&
          board.segments.map((seg) => (
            <line
              key={`hit-${seg.id}`}
              x1={px(seg.a.x)}
              y1={px(seg.a.y)}
              x2={px(seg.b.x)}
              y2={px(seg.b.y)}
              className="seg-hit"
              onClick={() => toggle(seg.id)}
            />
          ))}
      </svg>

      {editable && (
        <div className="board-tools">
          <button type="button" className="btn ghost" onClick={clear}>
            Clear
          </button>
          <span className="board-hint">Tap the faint lines to trace your word</span>
        </div>
      )}
    </div>
  );
}
