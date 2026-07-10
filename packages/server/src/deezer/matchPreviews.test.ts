import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { CandidateTrack } from '../types/index.js';
import { matchPreviews } from './matchPreviews.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(routes: (url: string) => unknown) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = routes(url);
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

const cand = (over: Partial<CandidateTrack>): CandidateTrack => ({
  providerId: 's1',
  title: 'Song',
  artist: 'Artist',
  isrc: null,
  ...over,
});

test('matches by ISRC and keeps Spotify metadata with the Deezer preview', async () => {
  stubFetch((url) =>
    url.includes('/track/isrc:USABC1234567')
      ? { id: 42, title: 'deezer title', preview: 'https://cdn/preview.mp3' }
      : undefined,
  );
  const [track] = await matchPreviews([cand({ providerId: 'x', title: 'Real', artist: 'Band', isrc: 'USABC1234567' })]);
  assert.equal(track?.id, 'x');
  assert.equal(track?.title, 'Real'); // provider title, not Deezer's
  assert.equal(track?.previewUrl, 'https://cdn/preview.mp3');
});

test('falls back to search when ISRC has no preview', async () => {
  stubFetch((url) => {
    if (url.includes('/track/isrc:')) return { error: { message: 'no data' } };
    if (url.includes('/search')) return { data: [{ id: 1, title: 't', preview: 'https://cdn/s.mp3' }] };
    return undefined;
  });
  const [track] = await matchPreviews([cand({ isrc: 'DEAD00000000' })]);
  assert.equal(track?.previewUrl, 'https://cdn/s.mp3');
});

test('drops tracks with no findable preview', async () => {
  stubFetch((url) => {
    if (url.includes('/search')) return { data: [] };
    return undefined;
  });
  const out = await matchPreviews([cand({}), cand({ providerId: 's2' })]);
  assert.equal(out.length, 0);
});
