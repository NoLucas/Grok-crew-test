import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, fetchLatestRelease, updatePolicy } from './update-service.mjs';

test('compareVersions orders dotted versions', () => {
  assert.equal(compareVersions('0.2.3', '0.2.3'), 0);
  assert.equal(compareVersions('0.2.3', '0.3.0'), 1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), -1);
});

test('unpackaged builds use a local fallback instead of installing', () => {
  const value = updatePolicy({ packaged: false, currentVersion: '0.2.3' });
  assert.equal(value.status, 'dev_fallback');
  assert.equal(value.currentVersion, '0.2.3');
});

test('packaged builds without a feed stay on notify-only', () => {
  const value = updatePolicy({ packaged: true, currentVersion: '0.2.3', feedConfigured: false });
  assert.equal(value.status, 'no_feed');
});

test('a newer unsigned release is available externally', () => {
  const value = updatePolicy({
    packaged: true,
    currentVersion: '0.2.3',
    latestVersion: '1.0.0',
    releaseUrl: 'https://github.com/NoLucas/Grok-crew-test/releases/tag/v1.0.0',
    feedConfigured: true,
    signed: false,
  });
  assert.equal(value.status, 'available_external');
  assert.match(value.releaseUrl, /releases/);
});

test('fetchLatestRelease treats a missing release as an empty feed', async () => {
  const latest = await fetchLatestRelease('owner/repo', async () => ({ status: 404, ok: false }));
  assert.equal(latest, null);
});
