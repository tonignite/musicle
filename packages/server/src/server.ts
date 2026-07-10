import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config, spotifyConfigured } from './config.js';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { rooms } from './rooms/RoomManager.js';
import { attachSockets } from './ws/socket.js';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: '*' });

  app.get('/health', async () => ({ ok: true, rooms: rooms.size, spotify: spotifyConfigured() }));
  await app.register(roomRoutes);
  await app.register(authRoutes);

  await app.listen({ port: config.port, host: config.host });

  // Share Fastify's underlying HTTP server with Socket.IO.
  attachSockets(app.server);
  app.log.info(
    `Musicle server ready — REST + WebSocket on :${config.port} (spotify ${spotifyConfigured() ? 'on' : 'off'})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
