import { mockLibraryFor } from '../game/mockTracks.js';
import type { Track } from '../types/index.js';

/**
 * Source of a player's playable tracks. The game engine depends only on this
 * interface, so Spotify (phase 2), Tidal, and YouTube Music (phase 5) all plug
 * in the same way. Implementations return tracks that already have a working
 * preview URL.
 */
export interface LibraryProvider {
  /** Up to `size` preview-ready tracks for the player, freshly shuffled. */
  getLibrary(playerId: string, size: number): Track[];
}

/** Phase-1 / test provider backed by the seeded mock catalog. */
export class MockLibraryProvider implements LibraryProvider {
  getLibrary(playerId: string, size: number): Track[] {
    return mockLibraryFor(playerId, size);
  }
}
