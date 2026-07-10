import cors from '@fastify/cors';
import Fastify from 'fastify';
import { roomRoutes } from './routes/rooms.js';
import { rooms } from './rooms/RoomManager.js';
import { attachSockets } from './ws/socket.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: '*' });

  app.get('/health', async () => ({ ok: true, rooms: rooms.size }));
  await app.register(roomRoutes);

  await app.listen({ port: PORT, host: HOST });

  // Share Fastify's underlying HTTP server with Socket.IO.
  attachSockets(app.server);
  app.log.info(`Musicle server ready — REST + WebSocket on :${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
