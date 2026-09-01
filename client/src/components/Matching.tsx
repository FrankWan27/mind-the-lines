import type { PublicGameState } from '../../../shared/src/types';
import { socket } from '../socket';
import BoardCanvas from './BoardCanvas';

interface Props {
  state: PublicGameState;
  playerId: string;
}

/**
 * Cooperative matching: everyone sees every drawing and picks a word for each
 * from the shared wordChoices deck. Matches are shared live via 'match:set'.
 * Any player can confirm once every drawing has a word.
 */
export default function Matching({ state, playerId }: Props) {
  const round = state.round;
  if (!round) return null;

  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? 'Player';

  const chosen = round.matches;
  const allAssigned = round.drawings.every((d) => !!chosen[d.playerId]);

  // A word already used by another drawing (each real prompt is used once).
  const usedElsewhere = (word: string, forPlayer: string) =>
    Object.entries(chosen).some(([pid, w]) => w === word && pid !== forPlayer);

  function setMatch(drawingPlayerId: string, word: string) {
    socket.emit('match:set', { drawingPlayerId, word: word || null });
  }

  return (
    <div className="screen matching">
      <div className="match-head">
        <h1 className="title">Match the drawings</h1>
        <p className="subtitle">
          Which word was each player tracing? Decide together.
        </p>
      </div>

      <div className="gallery">
        {round.drawings.map((d) => {
          const board = round.boards[d.playerId];
          const isMine = d.playerId === playerId;
          return (
            <div className="gallery-item card" key={d.playerId}>
              <div className="gallery-author">
                {nameOf(d.playerId)}
                {isMine && <span className="tag you">you</span>}
              </div>
              {board ? (
                <BoardCanvas board={board} value={d.strokes} editable={false} />
              ) : (
                <div className="muted">No board</div>
              )}
              <select
                className="word-select"
                value={chosen[d.playerId] ?? ''}
                onChange={(e) => setMatch(d.playerId, e.target.value)}
              >
                <option value="">— pick a word —</option>
                {round.wordChoices.map((w) => (
                  <option key={w} value={w} disabled={usedElsewhere(w, d.playerId)}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="btn primary big"
        onClick={() => socket.emit('match:confirm')}
        disabled={!allAssigned}
      >
        {allAssigned ? 'Confirm matches' : 'Match every drawing first'}
      </button>
    </div>
  );
}
