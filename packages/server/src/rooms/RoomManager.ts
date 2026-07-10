import { makeRoomCode, Room } from '../game/Room.js';

/**
 * In-memory registry of active game sessions. Phase 1 keeps everything in
 * process; phase 4 moves live state to Redis so many server instances can
 * share sessions.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(host: { id: string; name: string }): Room {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const room = new Room(code, host);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Requires an existing room; throws a tagged error the routes map to 404. */
  require(code: string): Room {
    const room = this.get(code);
    if (!room) {
      const err = new Error(`room ${code} not found`);
      (err as { statusCode?: number }).statusCode = 404;
      throw err;
    }
    return room;
  }

  destroy(code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (room) {
      room.dispose();
      this.rooms.delete(room.code);
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}

export const rooms = new RoomManager();
