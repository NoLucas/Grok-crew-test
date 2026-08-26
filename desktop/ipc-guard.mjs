export function studioRequestUrl(apiBase, path) {
  const raw = String(path ?? '');
  if (!raw.startsWith('/') || raw.includes('\\') || raw.includes('\0')) {
    throw new Error('Blocked Studio IPC request.');
  }
  const base = new URL(apiBase.endsWith('/') ? apiBase : `${apiBase}/`);
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    throw new Error('Blocked Studio IPC request.');
  }
  if (url.origin !== base.origin || url.username || url.password) {
    throw new Error('Blocked Studio IPC request.');
  }
  if (!url.pathname.startsWith('/api/')) {
    throw new Error('Blocked Studio IPC request.');
  }
  return url;
}

export function isRendererNavigationAllowed(url, rendererUrl) {
  try {
    const allowed = new URL(rendererUrl);
    const target = new URL(url);
    return target.origin === allowed.origin && !target.username && !target.password;
  } catch {
    return false;
  }
}
