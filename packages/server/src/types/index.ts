/** Shared domain types for the Musicle game backend. */

export type Phase =
  | 'lobby'
  | 'collecting'
  | 'round'
  | 'reveal'
  | 'scoreboard'
  | 'ended';

/** How the pool of songs is built from players' libraries. */
export type ConfigMode = 'per-user' | 'random';

export interface RoomConfig {
  mode: ConfigMode;
  /** Songs to pull from each player when mode === 'per-user'. */
  songsPerUser: number;
  /** Total rounds to play when mode === 'random'. */
  totalRounds: number;
  /** Seconds a player has to guess in a round. */
  roundSeconds: number;
  /** Seconds the answer is shown before advancing to the next round. */
  revealSeconds: number;
}

export const DEFAULT_CONFIG: RoomConfig = {
  mode: 'per-user',
  songsPerUser: 5,
  totalRounds: 15,
  roundSeconds: 20,
  revealSeconds: 5,
};

export interface Player {
  id: string;
  name: string;
  /** Socket.IO connection id, or null while disconnected. */
  socketId: string | null;
  connected: boolean;
  /** Whether this player has a linked account with a collected library. */
  linked: boolean;
  /** True while their library is being pulled + preview-matched. */
  collecting: boolean;
  /** Number of preview-ready tracks collected (0 until linked). */
  librarySize: number;
  score: number;
}

/** A track once matched to a playable preview clip. */
export interface Track {
  id: string;
  title: string;
  artist: string;
  /** 30s preview clip URL (Deezer/iTunes); mocked in phase 1. */
  previewUrl: string;
}

/** A track in the shuffled game pool, tagged with whose library it came from. */
export interface PooledTrack extends Track {
  ownerPlayerId: string;
}

export interface Guess {
  playerId: string;
  /** Guessed track id. */
  trackGuess: string | null;
  /** Guessed owner (player id). */
  ownerGuess: string | null;
  submittedAt: number;
}

export interface Round {
  index: number;
  track: PooledTrack;
  /** Multiple-choice options presented to players (ids incl. the real one). */
  trackChoices: Track[];
  guesses: Map<string, Guess>;
  startedAt: number;
  endsAt: number;
}

/** Client-safe snapshot of a room (no answers leaked mid-round). */
export interface RoomSnapshot {
  code: string;
  phase: Phase;
  hostId: string;
  config: RoomConfig;
  players: Array<Omit<Player, 'socketId'>>;
  currentRoundIndex: number;
  totalRounds: number;
}
