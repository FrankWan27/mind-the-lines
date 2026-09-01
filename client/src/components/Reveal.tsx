import type { PublicGameState } from '../../../shared/src/types';
import { socket } from '../socket';
import BoardCanvas from './BoardCanvas';

interface Props {
  state: PublicGameState;
  playerId: string;
}

/**
 * Reveal: for each drawing show the guessed word vs the true prompt (from
 * round.answers, populated only at reveal), with correct/incorrect styling and
 * the running team score. Host advances with round:next.
 */
export default function Reveal({ state, playerId }: Props) {
  const round = state.round;
  if (!round) return null;

  const answers = round.answers ?? {};
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? 'Player';
  const isHost = state.hostId === playerId;

  const roundCorrect = round.drawings.filter(
    (d) => round.matches[d.playerId] === answers[d.playerId],
  ).length;

  return (
    <div className="screen reveal">
      <div className="reveal-head">
        <h1 className="title">Round {round.index + 1} results</h1>
        <div className="scoreboard">
          <div className="score-pill">
            <span>This round</span>
            <strong>{roundCorrect}/{round.drawings.length}</strong>
          </div>
          <div className="score-pill accent">
            <span>Team total</span>
            <strong>{state.correctMatches}/{state.winThreshold}</strong>
          </div>
        </div>
      </div>

      <div className="gallery">
        {round.drawings.map((d) => {
          const board = round.boards[d.playerId];
          const guess = round.matches[d.playerId];
          const truth = answers[d.playerId];
          const correct = guess === truth;
          return (
            <div className={`gallery-item card ${correct ? 'correct' : 'incorrect'}`} key={d.playerId}>
              <div className="gallery-author">{nameOf(d.playerId)}</div>
              {board && <BoardCanvas board={board} value={d.strokes} editable={false} />}
              <div className="reveal-words">
                <div className="reveal-row">
                  <span className="rlabel">Guessed</span>
                  <span>{guess ?? '—'}</span>
                </div>
                <div className="reveal-row truth">
                  <span className="rlabel">Answer</span>
                  <span>{truth ?? '—'}</span>
                </div>
                <div className={`verdict ${correct ? 'ok' : 'bad'}`}>
                  {correct ? '✓ correct' : '✗ missed'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isHost ? (
        <button type="button" className="btn primary big" onClick={() => socket.emit('round:next')}>
          Next round
        </button>
      ) : (
        <p className="muted center">Waiting for the host to continue…</p>
      )}
    </div>
  );
}
