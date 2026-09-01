import { useState } from 'react';
import type { PublicGameState, GameSettings } from '../../../shared/src/types';
import { socket } from '../socket';

interface Props {
  state: PublicGameState | null;
  playerId: string | null;
  onEnterRoom: (roomCode: string) => void;
  initialRoomCode?: string;
}

/**
 * Lobby: if not in a room yet, show create/join. Once in a room, show the
 * player list, host settings, and the Start button (host only).
 */
export default function Lobby({ state, playerId, onEnterRoom, initialRoomCode }: Props) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(initialRoomCode ?? '');

  const inRoom = !!state && !!playerId;

  function create() {
    if (!name.trim()) return;
    socket.emit('lobby:create', { name: name.trim() }, (res) => {
      if (res.ok) onEnterRoom(res.data.roomCode);
    });
  }

  function join() {
    if (!name.trim() || !roomCode.trim()) return;
    socket.emit(
      'lobby:join',
      { roomCode: roomCode.trim().toUpperCase(), name: name.trim() },
      (res) => {
        if (res.ok) onEnterRoom(roomCode.trim().toUpperCase());
      },
    );
  }

  if (!inRoom) {
    return (
      <div className="screen lobby-entry">
        <h1 className="title">Mind the Lines</h1>
        <p className="subtitle">Trace your secret word using only the lines you're dealt.</p>

        <div className="card">
          <label className="field">
            <span>Your name</span>
            <input
              value={name}
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Frank"
            />
          </label>

          <button type="button" className="btn primary big" onClick={create} disabled={!name.trim()}>
            Create a room
          </button>

          <div className="divider"><span>or join</span></div>

          <label className="field">
            <span>Room code</span>
            <input
              value={roomCode}
              maxLength={6}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
            />
          </label>
          <button
            type="button"
            className="btn big"
            onClick={join}
            disabled={!name.trim() || !roomCode.trim()}
          >
            Join room
          </button>
        </div>
      </div>
    );
  }

  const isHost = state!.hostId === playerId;
  const settings = state!.settings;

  function updateSetting(patch: Partial<GameSettings>) {
    socket.emit('lobby:updateSettings', patch);
  }

  const shareUrl = `${location.origin}${location.pathname}#${state!.roomCode}`;

  return (
    <div className="screen lobby-room">
      <div className="room-head">
        <h1 className="title">Room {state!.roomCode}</h1>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => navigator.clipboard?.writeText(shareUrl)}
          title={shareUrl}
        >
          Copy invite link
        </button>
      </div>

      <div className="lobby-grid">
        <div className="card">
          <h2>Players ({state!.players.length})</h2>
          <ul className="player-list">
            {state!.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'offline'}>
                <span className="pdot" />
                {p.name}
                {p.isHost && <span className="tag">host</span>}
                {p.id === playerId && <span className="tag you">you</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2>Settings</h2>
          <label className="field">
            <span>Rounds: {settings.totalRounds}</span>
            <input
              type="range"
              min={1}
              max={10}
              value={settings.totalRounds}
              disabled={!isHost}
              onChange={(e) => updateSetting({ totalRounds: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Draw time: {settings.drawSeconds}s</span>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={settings.drawSeconds}
              disabled={!isHost}
              onChange={(e) => updateSetting({ drawSeconds: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Segments per board: {settings.segmentsPerBoard}</span>
            <input
              type="range"
              min={6}
              max={30}
              value={settings.segmentsPerBoard}
              disabled={!isHost}
              onChange={(e) => updateSetting({ segmentsPerBoard: Number(e.target.value) })}
            />
          </label>
          {!isHost && <p className="muted">Only the host can change settings.</p>}
        </div>
      </div>

      {isHost ? (
        <button
          type="button"
          className="btn primary big"
          onClick={() => socket.emit('game:start')}
          disabled={state!.players.length < 1}
        >
          Start game
        </button>
      ) : (
        <p className="muted center">Waiting for the host to start…</p>
      )}
    </div>
  );
}
