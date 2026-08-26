const DEFAULT_UPDATE_REPO = 'NoLucas/Grok-crew-test';
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function parts(version) {
  return String(version || '0.0.0').split(/[.-]/).map((item) => Number.parseInt(item, 10) || 0);
}

export function validateGitHubRepoSlug(repo) {
  const value = String(repo || '');
  return REPO_SLUG.test(value) && !value.includes('..');
}

export function resolveUpdateRepo(raw) {
  const value = String(raw || DEFAULT_UPDATE_REPO);
  return validateGitHubRepoSlug(value) ? value : DEFAULT_UPDATE_REPO;
}

export function parseReleasePageUrl(url, expectedRepo = '') {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  if (parsed.hostname !== 'github.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[2] !== 'releases') return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (!validateGitHubRepoSlug(repo)) return null;
  if (expectedRepo && repo.toLowerCase() !== String(expectedRepo).toLowerCase()) return null;
  return parsed.href;
}

export function compareVersions(current, latest) {
  const left = parts(current);
  const right = parts(latest);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (right[index] || 0) - (left[index] || 0);
    if (delta > 0) return 1;
    if (delta < 0) return -1;
  }
  return 0;
}

export function updatePolicy({
  packaged = false,
  currentVersion,
  latestVersion = null,
  releaseUrl = '',
  feedConfigured = false,
  signed = false,
} = {}) {
  if (!packaged) {
    return {
      status: 'dev_fallback',
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: '',
      message: 'Unpackaged desktop builds skip auto-update and stay on the local tree.',
    };
  }
  if (!feedConfigured || !latestVersion) {
    return {
      status: 'no_feed',
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: '',
      message: 'No GitHub release feed yet. Code signing and in-place install remain external.',
    };
  }
  if (compareVersions(currentVersion, latestVersion) > 0) {
    return {
      status: signed ? 'available' : 'available_external',
      currentVersion,
      latestVersion,
      releaseUrl,
      message: signed
        ? `Version ${latestVersion} is ready to install.`
        : `Version ${latestVersion} is published. Download it from the signed release once notarization is configured.`,
    };
  }
  return {
    status: 'up_to_date',
    currentVersion,
    latestVersion,
    releaseUrl,
    message: `This desktop build is on ${currentVersion}.`,
  };
}

export async function fetchLatestRelease(repo, fetchImpl = fetch) {
  if (!validateGitHubRepoSlug(repo)) {
    throw new Error('GitHub repository slug is not allowed.');
  }
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'grok-crew-desktop' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub releases returned ${response.status}.`);
  const payload = await response.json();
  return {
    latestVersion: String(payload.tag_name || '').replace(/^v/, ''),
    releaseUrl: parseReleasePageUrl(payload.html_url, repo) || '',
  };
}
