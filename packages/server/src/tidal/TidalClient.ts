import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { AccountTokens, CandidateTrack } from '../types/index.js';

/** Tidal uses the shared token shape. */
export type TidalTokens = AccountTokens;

const LOGIN = 'https://login.tidal.com';
const AUTH = 'https://auth.tidal.com';
const API = 'https://openapi.tidal.com/v2';

function basicAuthHeader(): string {
  const raw = `${config.tidal.clientId}:${config.tidal.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A PKCE verifier/challenge pair; the verifier is stashed with the OAuth state. */
export interface Pkce {
  verifier: string;
  challenge: string;
}

/** Tidal's authorize endpoint mandates PKCE (S256) even for confidential apps. */
export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Build the authorize URL the user is redirected to. */
export function authorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: config.tidal.clientId,
    response_type: 'code',
    redirect_uri: config.tidal.redirectUri,
    scope: config.tidal.scopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return `${LOGIN}/authorize?${params.toString()}`;
}

/** Exchange an authorization code (plus its PKCE verifier) for tokens. */
export async function exchangeCode(code: string, verifier: string): Promise<TidalTokens> {
  const res = await fetch(`${AUTH}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.tidal.redirectUri,
      client_id: config.tidal.clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`tidal token exchange failed: ${res.status} ${await res.text()}`);
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

/** Refresh an access token; Tidal may or may not return a new refresh token. */
export async function refreshTokens(tokens: TidalTokens): Promise<TidalTokens> {
  const res = await fetch(`${AUTH}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: config.tidal.clientId,
    }),
  });
  if (!res.ok) throw new Error(`tidal token refresh failed: ${res.status}`);
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
export async function ensureFresh(tokens: TidalTokens): Promise<TidalTokens> {
  if (Date.now() < tokens.expiresAt - 60_000) return tokens;
  return refreshTokens(tokens);
}

// --- Tidal v2 is a JSON:API surface: resources carry attributes + relationships,
// and related resources are sideloaded into `included` when requested via ?include.

interface Identifier {
  type: string;
  id: string;
}

interface Resource {
  type: string;
  id: string;
  attributes?: {
    title?: string;
    name?: string;
    isrc?: string;
  };
  relationships?: {
    artists?: { data?: Identifier[] };
  };
}

interface CollectionPage {
  data?: Array<Resource | Identifier>;
  included?: Resource[];
  links?: { next?: string | null };
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.api+json',
    },
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') ?? '1');
    await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
    return getJson<T>(url, accessToken);
  }
  if (!res.ok) throw new Error(`tidal GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Turn one collection page into candidates. Track objects and their artists both
 * arrive in `included` (thanks to ?include=tracks.artists); the top-level `data`
 * only holds resource identifiers, so we read attributes from `included`.
 * Exported for unit testing without a live Tidal account.
 */
export function parseCollectionPage(page: CollectionPage): CandidateTrack[] {
  const artistNames = new Map<string, string>();
  const tracks: Resource[] = [];
  for (const r of page.included ?? []) {
    if (r.type === 'artists' && r.attributes?.name) artistNames.set(r.id, r.attributes.name);
    else if (r.type === 'tracks') tracks.push(r);
  }
  // Some responses inline full track resources in `data` rather than identifiers.
  for (const r of page.data ?? []) {
    if (r.type === 'tracks' && 'attributes' in r) tracks.push(r);
  }

  const out: CandidateTrack[] = [];
  for (const t of tracks) {
    const title = t.attributes?.title;
    if (!t.id || !title) continue;
    const artist = (t.relationships?.artists?.data ?? [])
      .map((a) => artistNames.get(a.id))
      .filter((n): n is string => Boolean(n))
      .join(', ');
    out.push({ providerId: t.id, title, artist, isrc: t.attributes?.isrc ?? null });
  }
  return out;
}

async function currentUserId(accessToken: string): Promise<string> {
  const me = await getJson<{ data?: { id?: string } }>(`${API}/users/me`, accessToken);
  const id = me.data?.id;
  if (!id) throw new Error('tidal: could not resolve current user id');
  return id;
}

/**
 * Pull a player's Tidal library: the tracks in their collection ("My Collection"),
 * deduped by Tidal track id, until `limit` unique tracks are gathered.
 */
export async function pullLibrary(tokens: TidalTokens, limit: number): Promise<CandidateTrack[]> {
  const out = new Map<string, CandidateTrack>();
  const userId = await currentUserId(tokens.accessToken);

  const params = new URLSearchParams({
    countryCode: config.tidal.countryCode,
    include: 'tracks.artists',
  });
  let url: string | null =
    `${API}/userCollections/${userId}/relationships/tracks?${params.toString()}`;

  while (url && out.size < limit) {
    const page: CollectionPage = await getJson(url, tokens.accessToken);
    for (const c of parseCollectionPage(page)) out.set(c.providerId, c);
    const next = page.links?.next;
    // Tidal returns `next` as a path relative to the API host.
    url = next ? (next.startsWith('http') ? next : `https://openapi.tidal.com${next}`) : null;
  }

  return [...out.values()].slice(0, limit);
}
