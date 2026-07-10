import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import type { Room } from '../game/Room.js';
import { rooms } from '../rooms/RoomManager.js';

/**
 * Live round transport. Clients connect, join a room channel with their
 * playerId, then drive/receive the round loop. Room domain events are relayed
 * to the room's Socket.IO channel; per-room listeners are wired once.
 */
export function attachSockets(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, { cors: { origin: '*' } });
  const wired = new WeakSet<Room>();

  io.on('connection', (socket: Socket) => {
    let joined: { code: string; playerId: string } | null = null;

    socket.on('room:join', (payload: { code: string; playerId: string }, ack?: (r: unknown) => void) => {
      const room = rooms.get(payload?.code ?? '');
      const player = room?.players.get(payload?.playerId ?? '');
      if (!room || !player) {
        ack?.({ ok: false, error: 'room or player not found' });
        return;
      }
      joined = { code: room.code, playerId: player.id };
      player.socketId = socket.id;
      player.connected = true;
      socket.join(room.code);
      wireRoom(io, room, wired);
      room.emit('state', room.snapshot());
      ack?.({ ok: true, snapshot: room.snapshot() });
    });

    socket.on('game:start', (_p, ack?: (r: unknown) => void) => {
      const room = joined && rooms.get(joined.code);
      if (!room) return ack?.({ ok: false, error: 'not in a room' });
      if (joined!.playerId !== room.hostId) return ack?.({ ok: false, error: 'only host can start' });
      try {
        room.start();
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message });
      }
    });

    socket.on(
      'round:guess',
      (payload: { trackGuess: string | null; ownerGuess: string | null }, ack?: (r: unknown) => void) => {
        const room = joined && rooms.get(joined.code);
        if (!room) return ack?.({ ok: false, error: 'not in a room' });
        try {
          room.submitGuess(joined!.playerId, payload?.trackGuess ?? null, payload?.ownerGuess ?? null);
          ack?.({ ok: true });
        } catch (e) {
          ack?.({ ok: false, error: (e as Error).message });
        }
      },
    );

    socket.on('disconnect', () => {
      if (!joined) return;
      const room = rooms.get(joined.code);
      const player = room?.players.get(joined.playerId);
      if (player) {
        player.connected = false;
        player.socketId = null;
        room!.emit('state', room!.snapshot());
      }
    });
  });

  return io;
}

/** Wire a room's domain events to its Socket.IO channel exactly once. */
function wireRoom(io: IOServer, room: Room, wired: WeakSet<Room>): void {
  if (wired.has(room)) return;
  wired.add(room);
  room.on('state', (snapshot) => io.to(room.code).emit('room:state', snapshot));
  room.on('round:start', (payload) => io.to(room.code).emit('round:start', payload));
  room.on('round:reveal', (payload) => io.to(room.code).emit('round:reveal', payload));
  room.on('ended', (payload) => io.to(room.code).emit('game:ended', payload));
}
