import { nanoid } from 'nanoid';
import type {
  Board,
  Drawing,
  GamePhase,
  GameSettings,
  GameState,
  Player,
  PublicGameState,
  PublicRoundState,
  RoundState,
  Stroke,
} from '../../shared/src/types';
import { DEFAULT_SETTINGS } from '../../shared/src/types';
import { generateBoard } from './boardGen.js';
import { drawWords } from './wordBank.js';

/** Compute the cumulative match target needed to win. */
export function computeWinThreshold(totalPlayers: number, totalRounds: number): number {
  return Math.max(1, Math.ceil(totalPlayers * totalRounds * 0.6));
}

/** Fisher-Yates shuffle (in place), returns the same array. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * One room's game. Holds the authoritative GameState and exposes mutations.
 * Secret data (prompts, per-player boards) lives in `state.round` but is never
 * exposed through {@link toPublicState} before the matching phase.
 */
export class Game {
  readonly state: GameState;

  constructor(roomCode: string, hostId: string) {
    this.state = {
      roomCode,
      phase: 'lobby',
      players: [],
      hostId,
      round: null,
      totalRounds: DEFAULT_SETTINGS.totalRounds,
      correctMatches: 0,
      winThreshold: 0,
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  // --------------------------------------------------------------------------
  // Player lifecycle
  // --------------------------------------------------------------------------

  addPlayer(name: string): Player {
    const isFirst = this.state.players.length === 0;
    const player: Player = {
      id: nanoid(10),
      name: name.trim().slice(0, 24) || 'Player',
      connected: true,
      isHost: isFirst,
    };
    if (isFirst) this.state.hostId = player.id;
    this.state.players.push(player);
    return player;
  }

  getPlayer(playerId: string): Player | undefined {
    return this.state.players.find((p) => p.id === playerId);
  }

  /** Fully remove a player (used when they leave from the lobby). */
  removePlayer(playerId: string): void {
    this.state.players = this.state.players.filter((p) => p.id !== playerId);
    this.reassignHostIfNeeded(playerId);
  }

  /**
   * Mark a player disconnected without removing them (mid-game). If the host
   * dropped, hand the host role to another connected player.
   */
  markDisconnected(playerId: string): void {
    const p = this.getPlayer(playerId);
    if (!p) return;
    p.connected = false;
    this.reassignHostIfNeeded(playerId);
  }

  private reassignHostIfNeeded(departedId: string): void {
    if (this.state.hostId !== departedId) return;
    const nextHost = this.state.players.find((p) => p.connected) ?? this.state.players[0];
    if (nextHost) {
      this.state.players.forEach((p) => (p.isHost = p.id === nextHost.id));
      this.state.hostId = nextHost.id;
    }
  }

  // --------------------------------------------------------------------------
  // Lobby settings (host only, lobby only)
  // --------------------------------------------------------------------------

  updateSettings(playerId: string, patch: Partial<GameSettings>): boolean {
    if (this.state.phase !== 'lobby') return false;
    if (playerId !== this.state.hostId) return false;
    const s = this.state.settings;
    if (typeof patch.totalRounds === 'number') s.totalRounds = clampInt(patch.totalRounds, 1, 12);
    if (typeof patch.drawSeconds === 'number') s.drawSeconds = clampInt(patch.drawSeconds, 15, 600);
    if (typeof patch.segmentsPerBoard === 'number') s.segmentsPerBoard = clampInt(patch.segmentsPerBoard, 4, 40);
    this.state.totalRounds = s.totalRounds;
    return true;
  }

  // --------------------------------------------------------------------------
  // Game start / rounds
  // --------------------------------------------------------------------------

  canStart(playerId: string): boolean {
    return (
      this.state.phase === 'lobby' &&
      playerId === this.state.hostId &&
      this.state.players.length >= 2
    );
  }

  /** Deal boards + secret prompts, enter drawing phase for round 0. */
  start(): void {
    this.state.totalRounds = this.state.settings.totalRounds;
    this.state.correctMatches = 0;
    this.state.winThreshold = computeWinThreshold(this.state.players.length, this.state.totalRounds);
    this.beginRound(0);
  }

  private beginRound(index: number): void {
    const usedWords: string[] = [];
    const prompts: Record<string, string> = {};
    const boards: Record<string, Board> = {};

    // One distinct prompt word per player.
    const words = drawWords(this.state.players.length, usedWords);
    this.state.players.forEach((p, i) => {
      const word = words[i];
      prompts[p.id] = word;
      usedWords.push(word);
      const seed = `${this.state.roomCode}:r${index}:${p.id}`;
      boards[p.id] = generateBoard(seed, this.state.settings.segmentsPerBoard);
    });

    const round: RoundState = {
      index,
      prompts,
      boards,
      drawings: {},
      wordChoices: [],
      matches: {},
      drawDeadline: Date.now() + this.state.settings.drawSeconds * 1000,
    };
    this.state.round = round;
    this.state.phase = 'drawing';
  }

  // --------------------------------------------------------------------------
  // Drawing phase
  // --------------------------------------------------------------------------

  commitDrawing(playerId: string, strokes: Stroke[]): boolean {
    const round = this.state.round;
    if (!round || this.state.phase !== 'drawing') return false;
    const board = round.boards[playerId];
    if (!board) return false;

    // Strokes are free-drawn polylines already snapped to this board's lines on
    // the client. Sanity-clamp every point into [0,1] and drop empty strokes.
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const cleanStrokes: Stroke[] = strokes
      .map((st) => ({
        points: (st.points ?? [])
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })),
      }))
      .filter((st) => st.points.length >= 2);

    const drawing: Drawing = {
      playerId,
      boardSeed: board.seed,
      strokes: cleanStrokes,
    };
    round.drawings[playerId] = drawing;
    return true;
  }

  /** True once every connected player with a board has committed a drawing. */
  everyoneSubmitted(): boolean {
    const round = this.state.round;
    if (!round) return false;
    const expected = this.state.players.filter((p) => p.connected && round.boards[p.id]);
    if (expected.length === 0) return false;
    return expected.every((p) => round.drawings[p.id] !== undefined);
  }

  // --------------------------------------------------------------------------
  // Matching phase
  // --------------------------------------------------------------------------

  /** Build the shuffled word deck and enter matching. Idempotent-safe. */
  toMatching(): boolean {
    const round = this.state.round;
    if (!round || this.state.phase !== 'drawing') return false;

    const realPrompts = this.state.players
      .filter((p) => round.boards[p.id])
      .map((p) => round.prompts[p.id]);

    const decoys = drawWords(realPrompts.length, realPrompts);
    round.wordChoices = shuffle([...realPrompts, ...decoys]);

    // Initialize a match slot (null) for every player who has a board.
    round.matches = {};
    for (const p of this.state.players) {
      if (round.boards[p.id]) round.matches[p.id] = null;
    }

    round.drawDeadline = null;
    this.state.phase = 'matching';
    return true;
  }

  setMatch(drawingPlayerId: string, word: string | null): boolean {
    const round = this.state.round;
    if (!round || this.state.phase !== 'matching') return false;
    if (!(drawingPlayerId in round.matches)) return false;
    if (word !== null && !round.wordChoices.includes(word)) return false;
    round.matches[drawingPlayerId] = word;
    return true;
  }

  /** Score correct matches into the cumulative team total, enter reveal. */
  confirmMatching(): boolean {
    const round = this.state.round;
    if (!round || this.state.phase !== 'matching') return false;

    let correctThisRound = 0;
    for (const [playerId, chosen] of Object.entries(round.matches)) {
      if (chosen !== null && chosen === round.prompts[playerId]) correctThisRound++;
    }
    this.state.correctMatches += correctThisRound;
    this.state.phase = 'reveal';
    return true;
  }

  // --------------------------------------------------------------------------
  // Advancing
  // --------------------------------------------------------------------------

  /** Advance from reveal to the next round, or to gameover if finished. */
  nextRound(): boolean {
    const round = this.state.round;
    if (!round || this.state.phase !== 'reveal') return false;
    const nextIndex = round.index + 1;
    if (nextIndex >= this.state.totalRounds) {
      this.state.phase = 'gameover';
      return true;
    }
    this.beginRound(nextIndex);
    return true;
  }

  /** Reset back to the lobby, keeping players. */
  restart(): void {
    this.state.phase = 'lobby';
    this.state.round = null;
    this.state.correctMatches = 0;
    this.state.winThreshold = 0;
  }

  won(): boolean {
    return this.state.correctMatches >= this.state.winThreshold && this.state.winThreshold > 0;
  }

  // --------------------------------------------------------------------------
  // Views
  // --------------------------------------------------------------------------

  /** Private per-player payload for the 'prompt' event during drawing. */
  getPrivate(playerId: string): { word: string; board: Board } | null {
    const round = this.state.round;
    if (!round) return null;
    const word = round.prompts[playerId];
    const board = round.boards[playerId];
    if (word === undefined || board === undefined) return null;
    return { word, board };
  }

  /**
   * Public state safe to broadcast. NEVER leaks secret prompts before reveal,
   * and never leaks per-player boards before matching (own board is private).
   */
  toPublicState(): PublicGameState {
    const s = this.state;
    let publicRound: PublicRoundState | null = null;

    if (s.round) {
      const r = s.round;
      const revealed = s.phase === 'reveal' || s.phase === 'gameover';
      const inMatchingOrLater = revealed || s.phase === 'matching';

      publicRound = {
        index: r.index,
        drawDeadline: r.drawDeadline,
        // Drawings + boards are only meaningful once we are matching or later.
        drawings: inMatchingOrLater ? Object.values(r.drawings) : [],
        boards: inMatchingOrLater ? r.boards : {},
        wordChoices: inMatchingOrLater ? r.wordChoices : [],
        matches: inMatchingOrLater ? r.matches : {},
        answers: revealed ? { ...r.prompts } : null,
        submittedPlayerIds: Object.keys(r.drawings),
      };
    }

    return {
      roomCode: s.roomCode,
      phase: s.phase,
      players: s.players,
      hostId: s.hostId,
      totalRounds: s.totalRounds,
      correctMatches: s.correctMatches,
      winThreshold: s.winThreshold,
      settings: s.settings,
      round: publicRound,
    };
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  const n = Math.round(v);
  return n < lo ? lo : n > hi ? hi : n;
}
