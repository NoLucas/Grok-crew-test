function parts(version) {
  return String(version || '0.0.0').split(/[.-]/).map((item) => Number.parseInt(item, 10) || 0);
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
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'grok-crew-desktop' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub releases returned ${response.status}.`);
  const payload = await response.json();
  return {
    latestVersion: String(payload.tag_name || '').replace(/^v/, ''),
    releaseUrl: String(payload.html_url || ''),
  };
}
