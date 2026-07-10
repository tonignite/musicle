import { config } from '../config.js';
import { libraryStore, tokenStore } from '../library/index.js';
import { matchPreviews } from '../deezer/matchPreviews.js';
import { ensureFresh, pullLibrary } from './TidalClient.js';

/**
 * Pull a player's Tidal library and match each track to a playable Deezer
 * preview, then store the result in the LibraryStore. Returns the number of
 * preview-ready tracks collected.
 */
export async function collectPlayerLibrary(playerId: string): Promise<number> {
  const tokens = tokenStore.get(playerId);
  if (!tokens) throw new Error(`no Tidal tokens for player ${playerId}`);

  const fresh = await ensureFresh(tokens);
  tokenStore.set(playerId, fresh);

  const candidates = await pullLibrary(fresh, config.libraryTargetSize);
  const tracks = await matchPreviews(candidates);
  libraryStore.set(playerId, tracks);
  return tracks.length;
}
