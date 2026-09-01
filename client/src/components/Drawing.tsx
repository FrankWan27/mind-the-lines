import { useEffect, useState } from 'react';
import type { Board, PublicGameState, Stroke } from '../../../shared/src/types';
import { socket } from '../socket';
import BoardCanvas from './BoardCanvas';

interface Props {
  state: PublicGameState;
  playerId: string;
  prompt: { word: string; board: Board } | null;
}

function useCountdown(deadline: number | null): number {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0,
  );
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const h = setInterval(tick, 250);
    return () => clearInterval(h);
  }, [deadline]);
  return remaining;
}

/** Drawing phase: trace the secret word on the dealt board, then commit. */
export default function Drawing({ state, playerId, prompt }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [committed, setCommitted] = useState(false);
  const remaining = useCountdown(state.round?.drawDeadline ?? null);

  const submitted = state.round?.submittedPlayerIds ?? [];
  const iSubmitted = committed || submitted.includes(playerId);

  // Auto-commit when the timer hits zero.
  useEffect(() => {
    if (remaining === 0 && !iSubmitted && prompt) {
      socket.emit('draw:commit', { strokes });
      setCommitted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  function commit() {
    socket.emit('draw:commit', { strokes });
    setCommitted(true);
  }

  if (!prompt) {
    return (
      <div className="screen center">
        <p className="muted">Dealing your board…</p>
      </div>
    );
  }

  const total = state.players.length;

  return (
    <div className="screen drawing">
      <div className="draw-head">
        <div className="prompt-word">
          <span className="prompt-label">Your word</span>
          <strong>{prompt.word}</strong>
        </div>
        <div className={`countdown ${remaining <= 10 ? 'urgent' : ''}`}>{remaining}s</div>
        <div className="submit-count">
          {submitted.length}/{total} done
        </div>
      </div>

      <BoardCanvas
        board={prompt.board}
        value={strokes}
        editable={!iSubmitted}
        onChange={setStrokes}
      />

      {iSubmitted ? (
        <p className="muted center">Locked in. Waiting for everyone else…</p>
      ) : (
        <button
          type="button"
          className="btn primary big"
          onClick={commit}
          disabled={strokes.length === 0}
        >
          Lock in drawing
        </button>
      )}
    </div>
  );
}
