import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, POINTS } from './Room.js';

function readyRoom() {
  const room = new Room('TEST01', { id: 'host', name: 'Host' });
  room.addPlayer('p2', 'Bea');
  room.addPlayer('p3', 'Cy');
  for (const p of room.players.values()) p.linked = true;
  room.setConfig({ mode: 'per-user', songsPerUser: 3, roundSeconds: 60 });
  return room;
}

test('needs 3 linked players to start', () => {
  const room = new Room('T', { id: 'host', name: 'Host' });
  assert.equal(room.canStart().ok, false);
  room.addPlayer('p2', 'Bea');
  room.addPlayer('p3', 'Cy');
  assert.equal(room.canStart().ok, false, 'unlinked players block start');
  for (const p of room.players.values()) p.linked = true;
  assert.equal(room.canStart().ok, true);
});

test('config is locked once the game leaves the lobby', () => {
  const room = readyRoom();
  room.start();
  assert.throws(() => room.setConfig({ songsPerUser: 9 }), /lobby/);
});

test('pool has songsPerUser tracks per player in per-user mode', () => {
  const room = readyRoom();
  let firstStart: { choices: unknown[] } | null = null;
  room.on('round:start', (p) => (firstStart ??= p));
  room.start();
  // 3 players * 3 songs = 9 rounds total.
  assert.equal(room.snapshot().totalRounds, 9);
  assert.equal(room.phase, 'round');
  assert.ok(firstStart, 'a round started');
  assert.equal(firstStart!.choices.length, 4, 'real track + 3 decoys');
});

test('correct song + owner guess scores both axes', () => {
  const room = readyRoom();
  let reveal: { track: { id: string; ownerPlayerId: string } } | null = null;
  room.on('round:reveal', (p) => (reveal ??= p));
  room.start();

  // Reach into the current round's answer to simulate a perfect guess.
  const snap = room.snapshot();
  const round = (room as unknown as { rounds: Array<{ track: { id: string; ownerPlayerId: string } }> })
    .rounds[snap.currentRoundIndex]!;
  const { id, ownerPlayerId } = round.track;

  room.submitGuess('host', id, ownerPlayerId);
  room.submitGuess('p2', id, 'wrong');
  room.submitGuess('p3', 'wrong', 'wrong'); // triggers early reveal (all guessed)

  assert.ok(reveal, 'round revealed after everyone guessed');
  assert.equal(room.players.get('host')!.score, POINTS.song + POINTS.owner);
  assert.equal(room.players.get('p2')!.score, POINTS.song);
  assert.equal(room.players.get('p3')!.score, 0);
  room.dispose();
});
