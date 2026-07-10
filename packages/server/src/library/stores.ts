import { shuffle } from '../game/mockTracks.js';
import type { LibraryProvider } from '../providers/LibraryProvider.js';
import type { SpotifyTokens } from '../spotify/SpotifyClient.js';
import type { Track } from '../types/index.js';

/**
 * Per-player OAuth tokens. Kept out of the room snapshot so they never reach
 * clients. Phase 4 moves this to encrypted persistence.
 */
export class TokenStore {
  private readonly tokens = new Map<string, SpotifyTokens>();

  set(playerId: string, tokens: SpotifyTokens): void {
    this.tokens.set(playerId, tokens);
  }
  get(playerId: string): SpotifyTokens | undefined {
    return this.tokens.get(playerId);
  }
  has(playerId: string): boolean {
    return this.tokens.has(playerId);
  }
  delete(playerId: string): void {
    this.tokens.delete(playerId);
  }
}

/**
 * Preview-ready tracks collected per player. Implements LibraryProvider so the
 * game engine can sample real libraries the same way it samples mock ones.
 */
export class LibraryStore implements LibraryProvider {
  private readonly libraries = new Map<string, Track[]>();

  set(playerId: string, tracks: Track[]): void {
    this.libraries.set(playerId, tracks);
  }

  count(playerId: string): number {
    return this.libraries.get(playerId)?.length ?? 0;
  }

  getLibrary(playerId: string, size: number): Track[] {
    const all = this.libraries.get(playerId) ?? [];
    return shuffle([...all]).slice(0, Math.min(size, all.length));
  }

  clear(playerId: string): void {
    this.libraries.delete(playerId);
  }
}
