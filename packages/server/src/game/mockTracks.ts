import type { Track } from '../types/index.js';

/**
 * Phase-1 stand-in for real libraries. In phase 2 this is replaced by a
 * Spotify pull + Deezer preview match. Preview URLs here are placeholders.
 */
const CATALOG: Track[] = [
  { id: 't1', title: 'Blinding Lights', artist: 'The Weeknd', previewUrl: 'mock://t1' },
  { id: 't2', title: 'Bohemian Rhapsody', artist: 'Queen', previewUrl: 'mock://t2' },
  { id: 't3', title: 'Smells Like Teen Spirit', artist: 'Nirvana', previewUrl: 'mock://t3' },
  { id: 't4', title: 'Take On Me', artist: 'a-ha', previewUrl: 'mock://t4' },
  { id: 't5', title: 'Levitating', artist: 'Dua Lipa', previewUrl: 'mock://t5' },
  { id: 't6', title: 'Mr. Brightside', artist: 'The Killers', previewUrl: 'mock://t6' },
  { id: 't7', title: 'Get Lucky', artist: 'Daft Punk', previewUrl: 'mock://t7' },
  { id: 't8', title: 'Rolling in the Deep', artist: 'Adele', previewUrl: 'mock://t8' },
  { id: 't9', title: 'Seven Nation Army', artist: 'The White Stripes', previewUrl: 'mock://t9' },
  { id: 't10', title: 'HUMBLE.', artist: 'Kendrick Lamar', previewUrl: 'mock://t10' },
  { id: 't11', title: 'Dreams', artist: 'Fleetwood Mac', previewUrl: 'mock://t11' },
  { id: 't12', title: 'bad guy', artist: 'Billie Eilish', previewUrl: 'mock://t12' },
  { id: 't13', title: 'Uptown Funk', artist: 'Mark Ronson', previewUrl: 'mock://t13' },
  { id: 't14', title: 'Africa', artist: 'Toto', previewUrl: 'mock://t14' },
  { id: 't15', title: 'Sicko Mode', artist: 'Travis Scott', previewUrl: 'mock://t15' },
  { id: 't16', title: 'Wonderwall', artist: 'Oasis', previewUrl: 'mock://t16' },
  { id: 't17', title: 'Shape of You', artist: 'Ed Sheeran', previewUrl: 'mock://t17' },
  { id: 't18', title: 'Lose Yourself', artist: 'Eminem', previewUrl: 'mock://t18' },
  { id: 't19', title: 'Feel Good Inc.', artist: 'Gorillaz', previewUrl: 'mock://t19' },
  { id: 't20', title: 'Superstition', artist: 'Stevie Wonder', previewUrl: 'mock://t20' },
];

/** Deterministic-ish mock "library" for a player: a shuffled slice of the catalog. */
export function mockLibraryFor(playerId: string, size: number): Track[] {
  const shuffled = shuffle([...CATALOG], hashSeed(playerId));
  return shuffled.slice(0, Math.min(size, shuffled.length));
}

export function catalog(): Track[] {
  return [...CATALOG];
}

/** Fisher–Yates with a seeded PRNG so a given playerId yields a stable library. */
export function shuffle<T>(arr: T[], seed = Math.random() * 2 ** 32): T[] {
  let s = seed >>> 0;
  const rand = () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
