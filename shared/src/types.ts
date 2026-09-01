/**
 * Shared domain model + socket contract for Mind the Lines.
 * Imported by BOTH client and server so the wire protocol stays in sync.
 *
 * Game recap (cooperative, faithful to the physical board game):
 *  - Each player is dealt a board of RANDOM line segments (a "line graph").
 *  - Each player gets a SECRET prompt word and traces it using ONLY those
 *    segments (strokes snap to the dealt segments).
 *  - After the draw timer, all drawings are revealed. The real prompts are
 *    mixed with an equal number of decoy words.
 *  - The group cooperatively matches each drawing to a prompt word.
 *  - Score is a team result over N rounds vs a match threshold.
 */

// ----------------------------------------------------------------------------
// Geometry: the dealt "board" is a set of line segments (a graph of nodes/edges)
// ----------------------------------------------------------------------------

export interface Point {
  x: number; // normalized 0..1 within the board's square canvas
  y: number;
}

/** A single dealt line segment the player is allowed to trace along. */
export interface Segment {
  id: string;
  a: Point; // endpoint A
  b: Point; // endpoint B
}

/** The random board dealt to one player for one round. */
export interface Board {
  seed: string;
  segments: Segment[];
}

/**
 * A stroke the player commits by tracing. Because tracing is constrained to
 * dealt segments, a stroke is just the ordered list of segment ids traced.
 * Rendering re-derives the polyline from the board's segments.
 */
export interface Stroke {
  segmentIds: string[];
}

export interface Drawing {
  playerId: string;
  boardSeed: string;
  strokes: Stroke[];
}

// ----------------------------------------------------------------------------
// Lobby + players
// ----------------------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
}

export type GamePhase =
  | 'lobby'      // waiting for players; host can start
  | 'drawing'    // everyone traces their secret prompt, timed
  | 'matching'   // cooperative: group matches drawings to prompt words
  | 'reveal'     // round result shown
  | 'gameover';  // final team result

export interface RoundState {
  index: number;              // 0-based round number
  prompts: Record<string, string>; // playerId -> secret prompt word (server-only until reveal)
  boards: Record<string, Board>;   // playerId -> dealt board
  drawings: Record<string, Drawing>; // playerId -> committed drawing
  /** Shuffled deck shown in matching: real prompts + equal count of decoys. */
  wordChoices: string[];
  /** Cooperative matching: drawing(playerId) -> chosen word (null = unset). */
  matches: Record<string, string | null>;
  drawDeadline: number | null; // epoch ms when drawing phase ends
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  hostId: string;
  round: RoundState | null;
  totalRounds: number;
  correctMatches: number; // cumulative team score across rounds
  winThreshold: number;   // matches needed across all rounds to win
  settings: GameSettings;
}

export interface GameSettings {
  totalRounds: number;
  drawSeconds: number;
  segmentsPerBoard: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  totalRounds: 4,
  drawSeconds: 120,
  segmentsPerBoard: 14,
};

// ----------------------------------------------------------------------------
// Socket.IO event contract (typed both ways)
// ----------------------------------------------------------------------------

export interface ClientToServerEvents {
  'lobby:create': (payload: { name: string }, ack: (res: AckResult<{ roomCode: string; playerId: string }>) => void) => void;
  'lobby:join': (payload: { roomCode: string; name: string }, ack: (res: AckResult<{ playerId: string }>) => void) => void;
  'lobby:updateSettings': (payload: Partial<GameSettings>) => void;
  'game:start': () => void;
  'draw:commit': (payload: { strokes: Stroke[] }) => void;
  'match:set': (payload: { drawingPlayerId: string; word: string | null }) => void;
  'match:confirm': () => void;         // any player can advance a settled matching
  'round:next': () => void;            // host advances from reveal
  'game:restart': () => void;          // host restarts to lobby
}

export interface ServerToClientEvents {
  'state': (state: PublicGameState) => void;
  'you': (payload: { playerId: string }) => void;
  'prompt': (payload: { word: string; board: Board }) => void; // private per-player during drawing
  'error': (payload: { message: string }) => void;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Public state broadcast to everyone. Never leaks other players' secret
 * prompts before reveal, nor a player's own board (sent privately via 'prompt').
 */
export interface PublicGameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  hostId: string;
  totalRounds: number;
  correctMatches: number;
  winThreshold: number;
  settings: GameSettings;
  round: PublicRoundState | null;
}

export interface PublicRoundState {
  index: number;
  drawDeadline: number | null;
  /** Only populated once phase >= 'matching'. */
  drawings: Drawing[];
  boards: Record<string, Board>; // needed to render others' drawings in matching
  wordChoices: string[];
  matches: Record<string, string | null>;
  /** Revealed only in 'reveal'/'gameover'. */
  answers: Record<string, string> | null; // playerId -> true prompt
  submittedPlayerIds: string[]; // who has committed a drawing this round
}
