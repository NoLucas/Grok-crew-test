import assert from 'node:assert/strict';
import test from 'node:test';
import { isRendererNavigationAllowed, studioRequestUrl } from './ipc-guard.mjs';

const apiBase = 'http://127.0.0.1:7214';
const renderer = 'http://127.0.0.1:3000';

test('studio IPC allows /api paths and keeps query strings', () => {
  const url = studioRequestUrl(apiBase, '/api/v2/projects/abc/timeline?x=1');
  assert.equal(url.origin, 'http://127.0.0.1:7214');
  assert.equal(url.pathname, '/api/v2/projects/abc/timeline');
  assert.equal(url.search, '?x=1');
});

test('studio IPC rejects path traversal into /media', () => {
  assert.throws(() => studioRequestUrl(apiBase, '/api/../media/secret.mp4'));
});

test('studio IPC rejects absolute and protocol-relative URLs', () => {
  assert.throws(() => studioRequestUrl(apiBase, 'https://evil.example/api/projects'));
  assert.throws(() => studioRequestUrl(apiBase, '//evil.example/api/projects'));
});

test('renderer navigation matches origin, not prefix', () => {
  assert.equal(isRendererNavigationAllowed('http://127.0.0.1:3000/desktop', renderer), true);
  assert.equal(isRendererNavigationAllowed('http://127.0.0.1:3000@evil.example/', renderer), false);
  assert.equal(isRendererNavigationAllowed('https://evil.example/', renderer), false);
});
