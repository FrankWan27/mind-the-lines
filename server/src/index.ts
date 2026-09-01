import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/src/types';
import { Game } from './game.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

// 6-char uppercase room codes (no ambiguous chars).
const roomCodeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/** Per-socket data we attach so disconnect handling knows the room + player. */
interface SocketData {
  roomCode?: string;
  playerId?: string;
}

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  {
    cors: {
      origin: CLIENT_ORIGIN,
      methods: ['GET', 'POST'],
    },
  },
);

/** roomCode -> Game */
const rooms = new Map<string, Game>();

/** Auto-advance timers keyed by roomCode so we can clear/replace them. */
const drawTimers = new Map<string, NodeJS.Timeout>();

function broadcastState(roomCode: string): void {
  const game = rooms.get(roomCode);
  if (!game) return;
  io.to(roomCode).emit('state', game.toPublicState());
}

function clearDrawTimer(roomCode: string): void {
  const t = drawTimers.get(roomCode);
  if (t) {
    clearTimeout(t);
    drawTimers.delete(roomCode);
  }
}

/** Move a room into matching, clear its timer, and broadcast. */
function advanceToMatching(roomCode: string): void {
  const game = rooms.get(roomCode);
  if (!game) return;
  if (game.toMatching()) {
    clearDrawTimer(roomCode);
    broadcastState(roomCode);
  }
}

/** Deal the round: send each player their private prompt, arm the deadline. */
function beginDrawingBroadcast(roomCode: string): void {
  const game = rooms.get(roomCode);
  if (!game || !game.state.round) return;

  for (const player of game.state.players) {
    const priv = game.getPrivate(player.id);
    if (priv) {
      io.to(player.id).emit('prompt', { word: priv.word, board: priv.board });
    }
  }
  broadcastState(roomCode);

  clearDrawTimer(roomCode);
  const deadline = game.state.round.drawDeadline;
  if (deadline) {
    const delay = Math.max(0, deadline - Date.now());
    drawTimers.set(
      roomCode,
      setTimeout(() => advanceToMatching(roomCode), delay),
    );
  }
}

io.on('connection', (socket) => {
  // lobby:create -----------------------------------------------------------
  socket.on('lobby:create', ({ name }, ack) => {
    let roomCode = roomCodeGen();
    while (rooms.has(roomCode)) roomCode = roomCodeGen();

    const game = new Game(roomCode, '');
    const player = game.addPlayer(name);
    rooms.set(roomCode, game);

    socket.data.roomCode = roomCode;
    socket.data.playerId = player.id;
    void socket.join(roomCode);
    void socket.join(player.id); // private room for 'prompt' targeting

    ack({ ok: true, data: { roomCode, playerId: player.id } });
    socket.emit('you', { playerId: player.id });
    broadcastState(roomCode);
  });

  // lobby:join -------------------------------------------------------------
  socket.on('lobby:join', ({ roomCode, name }, ack) => {
    const code = (roomCode ?? '').toUpperCase();
    const game = rooms.get(code);
    if (!game) {
      ack({ ok: false, error: 'Room not found' });
      return;
    }
    if (game.state.phase !== 'lobby') {
      ack({ ok: false, error: 'Game already in progress' });
      return;
    }

    const player = game.addPlayer(name);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    void socket.join(code);
    void socket.join(player.id);

    ack({ ok: true, data: { playerId: player.id } });
    socket.emit('you', { playerId: player.id });
    broadcastState(code);
  });

  // lobby:updateSettings ---------------------------------------------------
  socket.on('lobby:updateSettings', (patch) => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (game.updateSettings(playerId, patch)) {
      broadcastState(roomCode);
    } else {
      socket.emit('error', { message: 'Only the host can change settings in the lobby' });
    }
  });

  // game:start -------------------------------------------------------------
  socket.on('game:start', () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (!game.canStart(playerId)) {
      socket.emit('error', { message: 'Need at least 2 players and host permission to start' });
      return;
    }
    game.start();
    beginDrawingBroadcast(roomCode);
  });

  // draw:commit ------------------------------------------------------------
  socket.on('draw:commit', ({ strokes }) => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (!game.commitDrawing(playerId, strokes ?? [])) return;
    broadcastState(roomCode);
    // If everyone is in early, skip straight to matching.
    if (game.everyoneSubmitted()) {
      advanceToMatching(roomCode);
    }
  });

  // match:set --------------------------------------------------------------
  socket.on('match:set', ({ drawingPlayerId, word }) => {
    const { roomCode } = socket.data;
    if (!roomCode) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (game.setMatch(drawingPlayerId, word)) {
      broadcastState(roomCode);
    }
  });

  // match:confirm ----------------------------------------------------------
  socket.on('match:confirm', () => {
    const { roomCode } = socket.data;
    if (!roomCode) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (game.confirmMatching()) {
      broadcastState(roomCode);
    }
  });

  // round:next -------------------------------------------------------------
  socket.on('round:next', () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (playerId !== game.state.hostId) {
      socket.emit('error', { message: 'Only the host can advance the round' });
      return;
    }
    if (game.nextRound()) {
      if (game.state.phase === 'drawing') {
        beginDrawingBroadcast(roomCode);
      } else {
        broadcastState(roomCode);
      }
    }
  });

  // game:restart -----------------------------------------------------------
  socket.on('game:restart', () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    if (playerId !== game.state.hostId) {
      socket.emit('error', { message: 'Only the host can restart the game' });
      return;
    }
    clearDrawTimer(roomCode);
    game.restart();
    broadcastState(roomCode);
  });

  // disconnect -------------------------------------------------------------
  socket.on('disconnect', () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    const game = rooms.get(roomCode);
    if (!game) return;

    if (game.state.phase === 'lobby') {
      game.removePlayer(playerId);
    } else {
      game.markDisconnected(playerId);
    }

    // Clean up empty rooms.
    if (game.state.players.length === 0 || game.state.players.every((p) => !p.connected)) {
      clearDrawTimer(roomCode);
      rooms.delete(roomCode);
      return;
    }
    broadcastState(roomCode);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[mind-the-lines] server listening on :${PORT} (client origin ${CLIENT_ORIGIN})`);
});
