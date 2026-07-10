import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config, spotifyConfigured } from '../config.js';
import { rooms } from '../rooms/RoomManager.js';
import { authorizeUrl, exchangeCode } from '../spotify/SpotifyClient.js';
import { collectPlayerLibrary } from '../spotify/collect.js';
import { tokenStore } from '../library/index.js';

interface Pending {
  roomCode: string;
  playerId: string;
  expiresAt: number;
}

/** Short-lived CSRF state store for the OAuth round trip. */
const pending = new Map<string, Pending>();
const STATE_TTL_MS = 10 * 60 * 1000;

function putState(roomCode: string, playerId: string): string {
  const state = randomUUID();
  pending.set(state, { roomCode, playerId, expiresAt: Date.now() + STATE_TTL_MS });
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
function finish(reply: import('fastify').FastifyReply, status: 'ok' | 'error', detail: string) {
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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Kick off the Spotify OAuth flow for a player already in a room.
  app.get<{ Querystring: { roomCode?: string; playerId?: string } }>(
    '/auth/spotify/login',
    async (req, reply) => {
      if (!spotifyConfigured())
        return reply.code(503).send({ error: 'Spotify is not configured on the server' });
      const { roomCode, playerId } = req.query;
      if (!roomCode || !playerId) return reply.code(400).send({ error: 'roomCode and playerId required' });
      const room = rooms.get(roomCode);
      if (!room || !room.players.has(playerId))
        return reply.code(404).send({ error: 'room or player not found' });
      if (room.phase !== 'lobby') return reply.code(409).send({ error: 'game already started' });

      const state = putState(room.code, playerId);
      return reply.redirect(authorizeUrl(state));
    },
  );

  // OAuth redirect target: exchange the code, then collect the library async.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/spotify/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return finish(reply, 'error', error);
      if (!code || !state) return finish(reply, 'error', 'missing code/state');

      const ctx = takeState(state);
      if (!ctx) return finish(reply, 'error', 'invalid or expired session');

      const room = rooms.get(ctx.roomCode);
      const player = room?.players.get(ctx.playerId);
      if (!room || !player) return finish(reply, 'error', 'room closed');

      try {
        const tokens = await exchangeCode(code);
        tokenStore.set(player.id, tokens);
      } catch (e) {
        req.log.error(e);
        return finish(reply, 'error', 'could not link Spotify');
      }

      // Import runs in the background; the lobby reflects progress via snapshots.
      player.collecting = true;
      player.linked = false;
      room.emit('state', room.snapshot());

      void collectPlayerLibrary(player.id)
        .then((count) => {
          player.collecting = false;
          player.linked = count > 0;
          player.librarySize = count;
          if (count === 0) req.log.warn(`no playable tracks found for ${player.id}`);
          room.emit('state', room.snapshot());
        })
        .catch((e) => {
          req.log.error(e);
          player.collecting = false;
          player.linked = false;
          room.emit('state', room.snapshot());
        });

      return finish(reply, 'ok', 'Importing your music…');
    },
  );
}
