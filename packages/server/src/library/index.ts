import { LibraryStore, TokenStore } from './stores.js';

/**
 * Process-wide singletons for phase 2. The library store doubles as the game's
 * LibraryProvider. Phase 4 swaps these for Redis/Postgres-backed impls.
 */
export const tokenStore = new TokenStore();
export const libraryStore = new LibraryStore();

export { LibraryStore, TokenStore } from './stores.js';
