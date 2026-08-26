import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareVersions,
  fetchLatestRelease,
  parseReleasePageUrl,
  resolveUpdateRepo,
  updatePolicy,
  validateGitHubRepoSlug,
} from './update-service.mjs';

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

test('GitHub repo slugs reject traversal and odd hosts', () => {
  assert.equal(validateGitHubRepoSlug('NoLucas/Grok-crew-test'), true);
  assert.equal(validateGitHubRepoSlug('../evil/repo'), false);
  assert.equal(validateGitHubRepoSlug('https://evil.example/repo'), false);
  assert.equal(resolveUpdateRepo('evil.com/../x'), 'NoLucas/Grok-crew-test');
});

test('release page URLs stay on github.com without credentials', () => {
  const repo = 'NoLucas/Grok-crew-test';
  assert.equal(
    parseReleasePageUrl('https://github.com/NoLucas/Grok-crew-test/releases/tag/v1.0.0', repo),
    'https://github.com/NoLucas/Grok-crew-test/releases/tag/v1.0.0',
  );
  assert.equal(parseReleasePageUrl('https://evil.example/NoLucas/Grok-crew-test/releases', repo), null);
  assert.equal(parseReleasePageUrl('https://user:pass@github.com/NoLucas/Grok-crew-test/releases', repo), null);
  assert.equal(parseReleasePageUrl('https://github.com/evil/malware/releases', repo), null);
});

test('fetchLatestRelease rejects an unsafe repository slug', async () => {
  await assert.rejects(
    () => fetchLatestRelease('../evil/repo', async () => ({ status: 200, ok: true, json: async () => ({}) })),
    /not allowed/,
  );
});
