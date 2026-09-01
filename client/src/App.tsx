import { useEffect, useState } from 'react';
import type { Board, PublicGameState } from '../../shared/src/types';
import { socket } from './socket';
import Lobby from './components/Lobby';
import Drawing from './components/Drawing';
import Matching from './components/Matching';
import Reveal from './components/Reveal';

type PrivatePrompt = { word: string; board: Board } | null;

/** Read the room code from the URL hash (#ABCD) for easy sharing. */
function roomFromHash(): string {
  return location.hash.replace(/^#/, '').trim().toUpperCase();
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [prompt, setPrompt] = useState<PrivatePrompt>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialRoom] = useState<string>(roomFromHash());

  useEffect(() => {
    const onYou = (p: { playerId: string }) => setPlayerId(p.playerId);
    const onState = (s: PublicGameState) => {
      setState(s);
      // Keep the URL hash in sync so the tab is shareable/refreshable.
      if (s.roomCode && roomFromHash() !== s.roomCode) {
        history.replaceState(null, '', `#${s.roomCode}`);
      }
    };
    const onPrompt = (p: { word: string; board: Board }) => setPrompt(p);
    const onError = (p: { message: string }) => {
      setError(p.message);
      window.setTimeout(() => setError(null), 4000);
    };

    socket.on('you', onYou);
    socket.on('state', onState);
    socket.on('prompt', onPrompt);
    socket.on('error', onError);

    return () => {
      socket.off('you', onYou);
      socket.off('state', onState);
      socket.off('prompt', onPrompt);
      socket.off('error', onError);
    };
  }, []);

  // Clear the stale private prompt whenever we leave the drawing phase.
  useEffect(() => {
    if (state && state.phase !== 'drawing') setPrompt(null);
  }, [state?.phase]);

  const phase = state?.phase ?? 'lobby';

  function renderPhase() {
    if (!state || !playerId || phase === 'lobby') {
      return (
        <Lobby
          state={state}
          playerId={playerId}
          initialRoomCode={initialRoom}
          onEnterRoom={(code) => history.replaceState(null, '', `#${code}`)}
        />
      );
    }

    switch (phase) {
      case 'drawing':
        return <Drawing state={state} playerId={playerId} prompt={prompt} />;
      case 'matching':
        return <Matching state={state} playerId={playerId} />;
      case 'reveal':
        return <Reveal state={state} playerId={playerId} />;
      case 'gameover':
        return <GameOver state={state} playerId={playerId} />;
      default:
        return null;
    }
  }

  return (
    <div className="app">
      {error && <div className="toast error">{error}</div>}
      {renderPhase()}
    </div>
  );
}

function GameOver({ state, playerId }: { state: PublicGameState; playerId: string }) {
  const won = state.correctMatches >= state.winThreshold;
  const isHost = state.hostId === playerId;
  return (
    <div className="screen center gameover">
      <h1 className={`title ${won ? 'win' : 'lose'}`}>{won ? 'You win! 🎉' : 'So close…'}</h1>
      <p className="subtitle">
        Team scored {state.correctMatches} of {state.winThreshold} needed
        across {state.totalRounds} rounds.
      </p>
      {isHost ? (
        <button
          type="button"
          className="btn primary big"
          onClick={() => socket.emit('game:restart')}
        >
          Play again
        </button>
      ) : (
        <p className="muted">Waiting for the host to start a new game…</p>
      )}
    </div>
  );
}
