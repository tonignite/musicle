import { config } from '../config.js';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
}

/** A track as pulled from Spotify, before preview matching. */
export interface CandidateTrack {
  spotifyId: string;
  title: string;
  artist: string;
  isrc: string | null;
}

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

function basicAuthHeader(): string {
  const raw = `${config.spotify.clientId}:${config.spotify.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

/** Build the authorize URL the user is redirected to. */
export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.spotify.clientId,
    response_type: 'code',
    redirect_uri: config.spotify.redirectUri,
    scope: config.spotify.scopes.join(' '),
    state,
    show_dialog: 'true',
  });
  return `${ACCOUNTS}/authorize?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(code: string): Promise<SpotifyTokens> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotify.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`spotify token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Refresh an access token; Spotify may or may not return a new refresh token. */
export async function refreshTokens(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`spotify token refresh failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Ensure the access token is valid, refreshing if it expires within 60s. */
export async function ensureFresh(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  if (Date.now() < tokens.expiresAt - 60_000) return tokens;
  return refreshTokens(tokens);
}

interface SpotifyTrackObject {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  external_ids?: { isrc?: string };
  is_local?: boolean;
}

interface Paging<T> {
  items: T[];
  next: string | null;
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') ?? '1');
    await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
    return getJson<T>(url, accessToken);
  }
  if (!res.ok) throw new Error(`spotify GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

function toCandidate(t: SpotifyTrackObject | null): CandidateTrack | null {
  if (!t || t.is_local || !t.id) return null;
  return {
    spotifyId: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    isrc: t.external_ids?.isrc ?? null,
  };
}

/**
 * Pull a player's library: saved ("liked") songs first, then tracks from their
 * playlists, until `limit` unique tracks are gathered. Deduped by Spotify id.
 */
export async function pullLibrary(tokens: SpotifyTokens, limit: number): Promise<CandidateTrack[]> {
  const out = new Map<string, CandidateTrack>();

  // 1) Saved tracks.
  let url: string | null = `${API}/me/tracks?limit=50`;
  while (url && out.size < limit) {
    const page: Paging<{ track: SpotifyTrackObject | null }> = await getJson(url, tokens.accessToken);
    for (const item of page.items) {
      const c = toCandidate(item.track);
      if (c) out.set(c.spotifyId, c);
    }
    url = page.next;
  }

  // 2) Playlist tracks, until we hit the limit.
  if (out.size < limit) {
    let plUrl: string | null = `${API}/me/playlists?limit=50`;
    const playlistIds: string[] = [];
    while (plUrl) {
      const page: Paging<{ id: string }> = await getJson(plUrl, tokens.accessToken);
      for (const pl of page.items) playlistIds.push(pl.id);
      plUrl = page.next;
    }
    for (const id of playlistIds) {
      if (out.size >= limit) break;
      let tUrl: string | null =
        `${API}/playlists/${id}/tracks?limit=100&fields=next,items(track(id,name,is_local,artists(name),external_ids(isrc)))`;
      while (tUrl && out.size < limit) {
        const page: Paging<{ track: SpotifyTrackObject | null }> = await getJson(tUrl, tokens.accessToken);
        for (const item of page.items) {
          const c = toCandidate(item.track);
          if (c) out.set(c.spotifyId, c);
        }
        tUrl = page.next;
      }
    }
  }

  return [...out.values()].slice(0, limit);
}
