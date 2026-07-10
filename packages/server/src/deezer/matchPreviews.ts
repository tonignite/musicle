import type { CandidateTrack, Track } from '../types/index.js';

/**
 * Deezer's public API needs no auth and still serves 30s preview clips, so we
 * use it to make provider tracks playable: match by ISRC (exact) first, then
 * fall back to an artist+title search. Tracks with no findable preview are
 * dropped from the pool.
 */

const DEEZER = 'https://api.deezer.com';

interface DeezerTrack {
  id: number;
  title: string;
  preview: string; // 30s mp3 url, '' when unavailable
}

async function deezerGet<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      return deezerGet<T>(url);
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function byIsrc(isrc: string): Promise<DeezerTrack | null> {
  const t = await deezerGet<DeezerTrack & { error?: unknown }>(`${DEEZER}/track/isrc:${encodeURIComponent(isrc)}`);
  if (!t || 'error' in t || !t.preview) return null;
  return t;
}

async function bySearch(artist: string, title: string): Promise<DeezerTrack | null> {
  const q = `artist:"${artist}" track:"${title}"`;
  const res = await deezerGet<{ data?: DeezerTrack[] }>(`${DEEZER}/search?q=${encodeURIComponent(q)}`);
  const hit = res?.data?.find((t) => t.preview);
  return hit ?? null;
}

async function matchOne(c: CandidateTrack): Promise<Track | null> {
  const found = (c.isrc && (await byIsrc(c.isrc))) || (await bySearch(c.artist, c.title));
  if (!found?.preview) return null;
  // Keep the provider's title/artist (canonical) but Deezer's playable preview.
  return { id: c.providerId, title: c.title, artist: c.artist, previewUrl: found.preview };
}

/** Run tasks with bounded concurrency to stay friendly to Deezer's rate limit. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Match a batch of candidates to playable tracks, dropping unmatched ones. */
export async function matchPreviews(candidates: CandidateTrack[]): Promise<Track[]> {
  const matched = await mapLimit(candidates, 6, matchOne);
  return matched.filter((t): t is Track => t !== null);
}
