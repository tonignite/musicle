// End-to-end smoke test: boots the real server and plays a full mock game
// through REST + WebSocket. Run: node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from 'socket.io-client';

const PORT = 4010;
const BASE = `http://localhost:${PORT}`;

const server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const fail = (msg) => {
  console.error('❌', msg);
  server.kill('SIGKILL');
  process.exit(1);
};
const assert = (cond, msg) => cond || fail(msg);

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) fail(`PATCH ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  fail('server never became healthy');
}

function connect(code, playerId) {
  const socket = io(BASE, { transports: ['websocket'] });
  return new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('room:join', { code, playerId }, (ack) => {
        assert(ack?.ok, `room:join failed: ${JSON.stringify(ack)}`);
        resolve(socket);
      });
    });
  });
}

async function main() {
  await waitForHealth();
  console.log('• server healthy');

  // Lobby via REST.
  const host = await api('/rooms', { name: 'Toni' });
  const { code } = host;
  const bea = await api(`/rooms/${code}/join`, { name: 'Bea' });
  const cy = await api(`/rooms/${code}/join`, { name: 'Cy' });
  console.log(`• room ${code} with 3 players`);

  const players = [
    { name: 'Toni', id: host.playerId },
    { name: 'Bea', id: bea.playerId },
    { name: 'Cy', id: cy.playerId },
  ];
  for (const p of players) await api(`/rooms/${code}/link`, { playerId: p.id });

  // Config: fast rounds for the test.
  await patch(`/rooms/${code}/config`, {
    playerId: host.playerId,
    config: { mode: 'per-user', songsPerUser: 2, roundSeconds: 30, revealSeconds: 1 },
  });
  console.log('• all linked, config set (2 songs/user, fast reveal)');

  // Connect all three over WebSocket.
  const sockets = await Promise.all(players.map((p) => connect(code, p.id)));

  let roundStarts = 0;
  let reveals = 0;
  const ended = once(sockets[0], 'game:ended');

  // Each client guesses as soon as a round starts (drives early reveal).
  sockets.forEach((socket, i) => {
    socket.on('round:start', (payload) => {
      if (i === 0) {
        roundStarts++;
        assert(typeof payload.previewUrl === 'string' && payload.previewUrl, 'round has a preview url');
        assert(payload.choices?.length === 4, 'round has 4 choices');
      }
      const choice = payload.choices[Math.floor(Math.random() * payload.choices.length)];
      socket.emit('round:guess', {
        trackGuess: choice.id,
        ownerGuess: players[Math.floor(Math.random() * players.length)].id,
      });
    });
    if (i === 0) socket.on('round:reveal', () => reveals++);
  });

  // Host starts the game.
  await new Promise((resolve) =>
    sockets[0].emit('game:start', {}, (ack) => {
      assert(ack?.ok, `game:start failed: ${JSON.stringify(ack)}`);
      resolve();
    }),
  );
  console.log('• game started');

  const [result] = await ended;
  const expectedRounds = 3 * 2; // players * songsPerUser
  assert(roundStarts === expectedRounds, `expected ${expectedRounds} rounds, saw ${roundStarts}`);
  assert(reveals === expectedRounds, `expected ${expectedRounds} reveals, saw ${reveals}`);
  assert(Array.isArray(result.scores) && result.scores.length === 3, 'final scoreboard has 3 players');

  console.log(`• game ended after ${roundStarts} rounds`);
  console.log('  final:', result.scores.map((s) => `${s.name}=${s.score}`).join('  '));
  console.log('✅ smoke test passed');

  sockets.forEach((s) => s.close());
  server.kill('SIGKILL');
  process.exit(0);
}

main().catch((e) => fail(e?.stack ?? String(e)));

// Safety timeout so a hang doesn't wedge CI.
setTimeout(() => fail('timed out'), 30_000).unref();
