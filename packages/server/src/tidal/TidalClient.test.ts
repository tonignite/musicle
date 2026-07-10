import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPkce, parseCollectionPage } from './TidalClient.js';

test('createPkce produces a url-safe verifier and matching S256 challenge', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, challenge);
});

test('parseCollectionPage resolves track attributes and sideloaded artists', () => {
  const page = {
    data: [{ type: 'tracks', id: '1' }],
    included: [
      {
        type: 'tracks',
        id: '1',
        attributes: { title: 'Digital Love', isrc: 'GBDUW0000059' },
        relationships: { artists: { data: [{ type: 'artists', id: 'a1' }, { type: 'artists', id: 'a2' }] } },
      },
      { type: 'artists', id: 'a1', attributes: { name: 'Daft Punk' } },
      { type: 'artists', id: 'a2', attributes: { name: 'Guest' } },
    ],
  };
  const [c] = parseCollectionPage(page);
  assert.equal(c?.providerId, '1');
  assert.equal(c?.title, 'Digital Love');
  assert.equal(c?.artist, 'Daft Punk, Guest');
  assert.equal(c?.isrc, 'GBDUW0000059');
});

test('parseCollectionPage skips tracks without a title', () => {
  const page = {
    included: [
      { type: 'tracks', id: '1', attributes: {} },
      { type: 'tracks', id: '2', attributes: { title: 'Ok' } },
    ],
  };
  const out = parseCollectionPage(page);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.providerId, '2');
  assert.equal(out[0]?.artist, ''); // no artist relationship => empty string
});
