import { nanoid } from 'nanoid';
import { TypedEmitter } from '../util/TypedEmitter.js';
import {
  DEFAULT_CONFIG,
  type Guess,
  type Phase,
  type Player,
  type PooledTrack,
  type Round,
  type RoomConfig,
  type RoomSnapshot,
  type Track,
} from '../types/index.js';
import { catalog, mockLibraryFor, shuffle } from './mockTracks.js';

/** Points awarded per correct axis of a guess. */
export const POINTS = { song: 100, owner: 100 } as const;

type RoomEvents = {
  /** Full sanitized snapshot changed; re-broadcast to everyone. */
  state: [RoomSnapshot];
  /** A new round began; payload is safe to send to players (no answers). */
  'round:start': [{ index: number; previewUrl: string; choices: Track[]; endsAt: number }];
  /** Round ended; reveals the answer and per-player deltas. */
  'round:reveal': [{ index: number; track: PooledTrack; scores: Array<{ playerId: string; score: number; gained: number }> }];
  /** Game finished. */
  ended: [{ scores: Array<{ playerId: string; name: string; score: number }> }];
};

/**
 * A single game session. Owns its state machine and round timers.
 * Decoupled from the transport: it emits typed events the WS layer relays.
 */
export class Room extends TypedEmitter<RoomEvents> {
  readonly code: string;
  hostId: string;
  phase: Phase = 'lobby';
  config: RoomConfig = { ...DEFAULT_CONFIG };

  readonly players = new Map<string, Player>();

  private pool: PooledTrack[] = [];
  private rounds: Round[] = [];
  currentRoundIndex = -1;
  private roundTimer: NodeJS.Timeout | null = null;

  constructor(code: string, host: { id: string; name: string }) {
    super();
    this.code = code;
    this.hostId = host.id;
    this.addPlayer(host.id, host.name);
  }

  // ---- lobby ---------------------------------------------------------------

  addPlayer(id: string, name: string): Player {
    const existing = this.players.get(id);
    if (existing) return existing;
    const player: Player = { id, name, socketId: null, connected: false, linked: false, score: 0 };
    this.players.set(id, player);
    return player;
  }

  setConfig(patch: Partial<RoomConfig>): void {
    if (this.phase !== 'lobby') throw new Error('config can only change in the lobby');
    this.config = { ...this.config, ...patch };
  }

  /** Every non-host player must be "linked" and there must be >= 3 players. */
  canStart(): { ok: boolean; reason?: string } {
    if (this.phase !== 'lobby') return { ok: false, reason: 'already started' };
    if (this.players.size < 3) return { ok: false, reason: 'need at least 3 players' };
    const unlinked = [...this.players.values()].filter((p) => !p.linked);
    if (unlinked.length > 0) return { ok: false, reason: 'all players must link an account' };
    return { ok: true };
  }

  // ---- game loop -----------------------------------------------------------

  start(): void {
    const check = this.canStart();
    if (!check.ok) throw new Error(check.reason);

    this.phase = 'collecting';
    this.emitState();

    this.buildPool();

    this.currentRoundIndex = 0;
    this.startRound();
  }

  private buildPool(): void {
    const players = [...this.players.values()];
    const perUser =
      this.config.mode === 'per-user'
        ? this.config.songsPerUser
        : Math.max(this.config.totalRounds, 1); // random: pull generously, then slice

    const tagged: PooledTrack[] = [];
    for (const p of players) {
      for (const t of mockLibraryFor(p.id, perUser)) {
        tagged.push({ ...t, ownerPlayerId: p.id });
      }
    }

    let pool = shuffle(tagged);
    if (this.config.mode === 'random') {
      pool = pool.slice(0, this.config.totalRounds);
    }
    this.pool = pool;
  }

  private get totalRounds(): number {
    return this.pool.length;
  }

  private startRound(): void {
    const track = this.pool[this.currentRoundIndex];
    if (!track) {
      this.end();
      return;
    }

    const round: Round = {
      index: this.currentRoundIndex,
      track,
      trackChoices: this.buildChoices(track),
      guesses: new Map(),
      startedAt: Date.now(),
      endsAt: Date.now() + this.config.roundSeconds * 1000,
    };
    this.rounds[this.currentRoundIndex] = round;
    this.phase = 'round';
    this.emitState();

    this.emit('round:start', {
      index: round.index,
      previewUrl: track.previewUrl,
      choices: round.trackChoices,
      endsAt: round.endsAt,
    });

    this.roundTimer = setTimeout(() => this.reveal(), this.config.roundSeconds * 1000);
  }

  /** Real track plus 3 decoys from the catalog, shuffled. */
  private buildChoices(track: PooledTrack): Track[] {
    const decoys = shuffle(catalog().filter((t) => t.id !== track.id)).slice(0, 3);
    const real: Track = { id: track.id, title: track.title, artist: track.artist, previewUrl: '' };
    return shuffle([real, ...decoys]);
  }

  submitGuess(playerId: string, trackGuess: string | null, ownerGuess: string | null): void {
    if (this.phase !== 'round') throw new Error('not accepting guesses right now');
    const round = this.rounds[this.currentRoundIndex];
    if (!round) return;
    if (!this.players.has(playerId)) throw new Error('unknown player');
    const guess: Guess = { playerId, trackGuess, ownerGuess, submittedAt: Date.now() };
    round.guesses.set(playerId, guess);

    // Everyone in (excluding host if host is a pure MC) has guessed -> end early.
    if (round.guesses.size >= this.players.size) {
      this.reveal();
    }
  }

  private reveal(): void {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    const round = this.rounds[this.currentRoundIndex];
    if (!round) return;

    this.phase = 'reveal';
    const deltas: Array<{ playerId: string; score: number; gained: number }> = [];
    for (const player of this.players.values()) {
      const g = round.guesses.get(player.id);
      let gained = 0;
      if (g) {
        if (g.trackGuess === round.track.id) gained += POINTS.song;
        if (g.ownerGuess === round.track.ownerPlayerId) gained += POINTS.owner;
      }
      player.score += gained;
      deltas.push({ playerId: player.id, score: player.score, gained });
    }

    this.emit('round:reveal', { index: round.index, track: round.track, scores: deltas });
    this.emitState();

    // Advance after a short reveal window.
    this.roundTimer = setTimeout(() => {
      this.currentRoundIndex += 1;
      if (this.currentRoundIndex >= this.totalRounds) this.end();
      else this.startRound();
    }, 5000);
  }

  private end(): void {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    this.phase = 'ended';
    const scores = [...this.players.values()]
      .map((p) => ({ playerId: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
    this.emit('ended', { scores });
    this.emitState();
  }

  // ---- snapshots -----------------------------------------------------------

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      config: this.config,
      players: [...this.players.values()].map(({ socketId, ...rest }) => rest),
      currentRoundIndex: this.currentRoundIndex,
      totalRounds: this.pool.length,
    };
  }

  private emitState(): void {
    this.emit('state', this.snapshot());
  }

  dispose(): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.removeAllListeners();
  }
}

/** 6-char, unambiguous, uppercase join code (no O/0/I/1). */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export { nanoid as makePlayerId };
