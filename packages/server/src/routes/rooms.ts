import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { makePlayerId } from '../game/Room.js';
import { mockLibraryFor } from '../game/mockTracks.js';
import { libraryStore } from '../library/index.js';
import { rooms } from '../rooms/RoomManager.js';
import type { RoomConfig } from '../types/index.js';

/**
 * REST surface for the lobby: create/join rooms, set config, mock-link
 * accounts. The live round runs over WebSocket (see ws/socket.ts).
 *
 * Phase-1 auth is intentionally thin: the playerId returned at create/join
 * acts as a bearer token. Phase 2 replaces this with real session tokens.
 */
export async function roomRoutes(app: FastifyInstance): Promise<void> {
  // Create a room; caller becomes host.
  app.post<{ Body: { name?: string } }>('/rooms', async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const hostId = makePlayerId();
    const room = rooms.create({ id: hostId, name });
    return reply.code(201).send({ code: room.code, playerId: hostId, snapshot: room.snapshot() });
  });

  // Join an existing room.
  app.post<{ Params: { code: string }; Body: { name?: string } }>(
    '/rooms/:code/join',
    async (req, reply) => {
      const name = (req.body?.name ?? '').trim();
      if (!name) return reply.code(400).send({ error: 'name is required' });
      const room = rooms.require(req.params.code);
      if (room.phase !== 'lobby') return reply.code(409).send({ error: 'game already started' });
      const playerId = makePlayerId();
      room.addPlayer(playerId, name);
      room.emit('state', room.snapshot());
      return reply.code(200).send({ playerId, snapshot: room.snapshot() });
    },
  );

  // Read current room state.
  app.get<{ Params: { code: string } }>('/rooms/:code', async (req) => {
    const room = rooms.require(req.params.code);
    return { snapshot: room.snapshot() };
  });

  // Host updates config (lobby only).
  app.patch<{ Params: { code: string }; Body: { playerId?: string; config?: Partial<RoomConfig> } }>(
    '/rooms/:code/config',
    async (req, reply) => {
      const room = rooms.require(req.params.code);
      if (req.body?.playerId !== room.hostId)
        return reply.code(403).send({ error: 'only the host can change config' });
      try {
        room.setConfig(req.body?.config ?? {});
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
      room.emit('state', room.snapshot());
      return { snapshot: room.snapshot() };
    },
  );

  // Dev-only "link" that seeds a mock library, so a full game can run without
  // Spotify. Real linking goes through GET /auth/spotify/login (see auth.ts).
  app.post<{ Params: { code: string }; Body: { playerId?: string } }>(
    '/rooms/:code/link',
    async (req, reply) => {
      const room = rooms.require(req.params.code);
      const player = req.body?.playerId ? room.players.get(req.body.playerId) : undefined;
      if (!player) return reply.code(404).send({ error: 'player not in room' });
      const tracks = mockLibraryFor(player.id, config.libraryTargetSize);
      libraryStore.set(player.id, tracks);
      player.linked = true;
      player.collecting = false;
      player.librarySize = tracks.length;
      room.emit('state', room.snapshot());
      return { snapshot: room.snapshot() };
    },
  );
}
