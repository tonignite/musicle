import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, spotifyConfigured, tidalConfigured } from '../config.js';
import type { Room } from '../game/Room.js';
import type { Player, ProviderId } from '../types/index.js';
import { rooms } from '../rooms/RoomManager.js';
import { authorizeUrl as spotifyAuthorizeUrl, exchangeCode as spotifyExchange } from '../spotify/SpotifyClient.js';
import { collectPlayerLibrary as collectSpotify } from '../spotify/collect.js';
import {
  authorizeUrl as tidalAuthorizeUrl,
  createPkce,
  exchangeCode as tidalExchange,
} from '../tidal/TidalClient.js';
import { collectPlayerLibrary as collectTidal } from '../tidal/collect.js';
import { tokenStore } from '../library/index.js';

interface Pending {
  provider: ProviderId;
  roomCode: string;
  playerId: string;
  /** PKCE verifier, for providers that require it (Tidal). */
  codeVerifier?: string;
  expiresAt: number;
}

/** Short-lived CSRF state store for the OAuth round trip. */
const pending = new Map<string, Pending>();
const STATE_TTL_MS = 10 * 60 * 1000;

function putState(p: Omit<Pending, 'expiresAt'>): string {
  const state = randomUUID();
  pending.set(state, { ...p, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

function takeState(state: string): Pending | null {
  const p = pending.get(state);
  if (!p) return null;
  pending.delete(state);
  if (Date.now() > p.expiresAt) return null;
  return p;
}

/** Redirect back to the app (deep link) or render a minimal status page. */
function finish(reply: FastifyReply, status: 'ok' | 'error', detail: string) {
  if (config.appReturnUrl) {
    const sep = config.appReturnUrl.includes('?') ? '&' : '?';
    return reply.redirect(`${config.appReturnUrl}${sep}status=${status}&detail=${encodeURIComponent(detail)}`);
  }
  const body =
    status === 'ok'
      ? `<h1>Linked ✓</h1><p>${detail}</p><p>You can return to Musicle.</p>`
      : `<h1>Link failed</h1><p>${detail}</p>`;
  return reply.type('text/html').send(`<!doctype html><meta charset="utf-8">${body}`);
}

const collectors: Record<ProviderId, (playerId: string) => Promise<number>> = {
  spotify: collectSpotify,
  tidal: collectTidal,
};

/** Kick off the library import in the background; the lobby reflects progress. */
function startCollect(room: Room, player: Player, provider: ProviderId, log: FastifyInstance['log']): void {
  player.collecting = true;
  player.linked = false;
  room.emit('state', room.snapshot());

  void collectors[provider](player.id)
    .then((count) => {
      player.collecting = false;
      player.linked = count > 0;
      player.librarySize = count;
      if (count === 0) log.warn(`no playable tracks found for ${player.id}`);
      room.emit('state', room.snapshot());
    })
    .catch((e) => {
      log.error(e);
      player.collecting = false;
      player.linked = false;
      room.emit('state', room.snapshot());
    });
}

/** Validate a login request and return the room/player, or send an error reply. */
function resolveLogin(
  req: FastifyRequest<{ Querystring: { roomCode?: string; playerId?: string } }>,
  reply: FastifyReply,
): { room: Room; playerId: string } | null {
  const { roomCode, playerId } = req.query;
  if (!roomCode || !playerId) {
    reply.code(400).send({ error: 'roomCode and playerId required' });
    return null;
  }
  const room = rooms.get(roomCode);
  if (!room || !room.players.has(playerId)) {
    reply.code(404).send({ error: 'room or player not found' });
    return null;
  }
  if (room.phase !== 'lobby') {
    reply.code(409).send({ error: 'game already started' });
    return null;
  }
  return { room, playerId };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Kick off the Spotify OAuth flow for a player already in a room.
  app.get<{ Querystring: { roomCode?: string; playerId?: string } }>(
    '/auth/spotify/login',
    async (req, reply) => {
      if (!spotifyConfigured())
        return reply.code(503).send({ error: 'Spotify is not configured on the server' });
      const ok = resolveLogin(req, reply);
      if (!ok) return reply;
      const state = putState({ provider: 'spotify', roomCode: ok.room.code, playerId: ok.playerId });
      return reply.redirect(spotifyAuthorizeUrl(state));
    },
  );

  // Kick off the Tidal OAuth flow (Authorization Code + PKCE).
  app.get<{ Querystring: { roomCode?: string; playerId?: string } }>(
    '/auth/tidal/login',
    async (req, reply) => {
      if (!tidalConfigured())
        return reply.code(503).send({ error: 'Tidal is not configured on the server' });
      const ok = resolveLogin(req, reply);
      if (!ok) return reply;
      const { verifier, challenge } = createPkce();
      const state = putState({
        provider: 'tidal',
        roomCode: ok.room.code,
        playerId: ok.playerId,
        codeVerifier: verifier,
      });
      return reply.redirect(tidalAuthorizeUrl(state, challenge));
    },
  );

  // Shared OAuth redirect target: exchange the code, then collect the library.
  async function handleCallback(
    req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
    reply: FastifyReply,
  ) {
    const { code, state, error } = req.query;
    if (error) return finish(reply, 'error', error);
    if (!code || !state) return finish(reply, 'error', 'missing code/state');

    const ctx = takeState(state);
    if (!ctx) return finish(reply, 'error', 'invalid or expired session');

    const room = rooms.get(ctx.roomCode);
    const player = room?.players.get(ctx.playerId);
    if (!room || !player) return finish(reply, 'error', 'room closed');

    try {
      const tokens =
        ctx.provider === 'tidal'
          ? await tidalExchange(code, ctx.codeVerifier ?? '')
          : await spotifyExchange(code);
      tokenStore.set(player.id, tokens);
    } catch (e) {
      req.log.error(e);
      return finish(reply, 'error', `could not link ${ctx.provider}`);
    }

    startCollect(room, player, ctx.provider, req.log);
    return finish(reply, 'ok', 'Importing your music…');
  }

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/spotify/callback', handleCallback);
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/tidal/callback', handleCallback);
}
