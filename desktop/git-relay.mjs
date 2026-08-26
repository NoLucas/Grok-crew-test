import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

function run(command, args, cwd, environment = {}) {
  try {
    return execFileSync(command, args, {
      cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...environment },
    }).trim();
  } catch (error) {
    const detail = String(error?.stderr ?? error?.stdout ?? error?.message ?? error).trim();
    throw new Error(detail || `${command} failed.`);
  }
}

function isWithin(root, candidate) {
  const rootPath = resolve(root); const target = resolve(candidate);
  return target === rootPath || target.startsWith(`${rootPath}${sep}`);
}

export class GitRelay {
  constructor({ dialog, safeStorage, userData, shell, clipboard, fetchImpl = fetch }) {
    this.dialog = dialog;
    this.safeStorage = safeStorage;
    this.userData = userData;
    this.shell = shell;
    this.clipboard = clipboard;
    this.fetch = fetchImpl;
  }

  configPath() { return join(this.userData, 'git-relay.bin'); }
  githubAuthPath() { return join(this.userData, 'github-auth.bin'); }
  worktreeRoot() { return join(this.userData, 'git-relay-worktrees'); }
  importedPath() { return join(this.userData, 'git-relay-imported.json'); }
  configured() { return existsSync(this.configPath()); }

  saveConfig(value) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    mkdirSync(this.userData, { recursive: true });
    writeFileSync(this.configPath(), this.safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  }

  config() {
    if (!existsSync(this.configPath())) throw new Error('Connect a private Git relay repository first.');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    return JSON.parse(this.safeStorage.decryptString(readFileSync(this.configPath())));
  }

  saveSecret(path, value) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    mkdirSync(this.userData, { recursive: true });
    writeFileSync(path, this.safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  }

  readSecret(path) {
    if (!existsSync(path)) return null;
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    return JSON.parse(this.safeStorage.decryptString(readFileSync(path)));
  }

  githubAuth() { return this.readSecret(this.githubAuthPath()); }

  gitEnvironment() {
    const token = this.githubAuth()?.access_token;
    if (!token) return {};
    const authorization = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    return {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'http.extraHeader', GIT_CONFIG_VALUE_1: authorization,
    };
  }

  git(repo, args) { return run('git', ['-C', repo, ...args], repo, this.gitEnvironment()); }

  async githubRequest(path, options = {}) {
    const safePath = String(path ?? '');
    if (!safePath.startsWith('/') || safePath.includes('//') || safePath.includes('\\') || safePath.includes('\0')) {
      throw new Error('Blocked GitHub API path.');
    }
    const auth = options.token ? { access_token: options.token } : this.githubAuth();
    if (!auth?.access_token) throw new Error('GitHub login is required.');
    const response = await this.fetch(`https://api.github.com${safePath}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${auth.access_token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Grok-Crew-Desktop',
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.message ?? `GitHub ${response.status}`));
    return payload;
  }

  async loginWithToken(token) {
    const value = String(token ?? '').trim();
    if (value.length < 20 || value.length > 500) throw new Error('Enter a valid GitHub access token.');
    const user = await this.githubRequest('/user', { token: value });
    this.saveSecret(this.githubAuthPath(), {
      schema: 'grok-crew.github-auth/v1', access_token: value, token_type: 'bearer',
      login: user.login, avatar_url: user.avatar_url, authenticated_at: new Date().toISOString(),
    });
    return { authenticated: true, login: user.login, avatar_url: user.avatar_url, method: 'token' };
  }

  async loginWithDeviceFlow() {
    const clientId = String(process.env.GROK_CREW_GITHUB_CLIENT_ID ?? '').trim();
    if (!clientId) throw new Error('GitHub OAuth client ID is not configured. Use the access-token login or set GROK_CREW_GITHUB_CLIENT_ID.');
    const response = await this.fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Grok-Crew-Desktop' },
      body: new URLSearchParams({ client_id: clientId, scope: 'repo read:user' }).toString(),
    });
    const device = await response.json();
    if (!response.ok || !device.device_code) throw new Error(String(device.error_description ?? device.error ?? 'GitHub device login could not start.'));
    this.clipboard?.writeText(String(device.user_code));
    let verification;
    try {
      verification = new URL(String(device.verification_uri ?? ''));
    } catch {
      throw new Error('GitHub returned an invalid device verification URL.');
    }
    if (
      verification.protocol !== 'https:'
      || verification.hostname !== 'github.com'
      || !verification.pathname.startsWith('/login/device')
      || verification.username
      || verification.password
    ) {
      throw new Error('GitHub device verification URL is not allowed.');
    }
    await this.shell?.openExternal(verification.href);
    const confirmation = await this.dialog.showMessageBox({
      type: 'info', title: 'GitHub 로그인',
      message: `브라우저에서 코드 ${device.user_code}를 확인하세요.`,
      detail: '코드는 클립보드에 복사했습니다. GitHub 인증을 마친 뒤 아래 버튼을 누르세요.',
      buttons: ['인증 완료', '취소'], defaultId: 0, cancelId: 1,
    });
    if (confirmation.response !== 0) return null;
    const deadline = Date.now() + Number(device.expires_in ?? 900) * 1_000;
    const interval = Math.max(5, Number(device.interval ?? 5)) * 1_000;
    while (Date.now() < deadline) {
      const tokenResponse = await this.fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Grok-Crew-Desktop' },
        body: new URLSearchParams({ client_id: clientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString(),
      });
      const token = await tokenResponse.json();
      if (token.access_token) return await this.loginWithToken(token.access_token);
      if (token.error === 'authorization_pending') { await new Promise((resolveWait) => setTimeout(resolveWait, interval)); continue; }
      if (token.error === 'slow_down') { await new Promise((resolveWait) => setTimeout(resolveWait, interval + 5_000)); continue; }
      throw new Error(String(token.error_description ?? token.error ?? 'GitHub login failed.'));
    }
    throw new Error('GitHub device login expired.');
  }

  githubStatus() {
    const auth = this.githubAuth();
    const relay = this.configured() ? this.config() : null;
    return {
      authenticated: Boolean(auth?.access_token), login: auth?.login ?? null,
      oauth_available: Boolean(String(process.env.GROK_CREW_GITHUB_CLIENT_ID ?? '').trim()),
      relay_connected: Boolean(relay), remote: relay?.remote ?? null,
    };
  }

  validateRepo(path) {
    const repo = resolve(path);
    if (!existsSync(join(repo, '.git'))) throw new Error('The selected folder is not a Git working copy.');
    this.git(repo, ['rev-parse', '--is-inside-work-tree']);
    const remotes = this.git(repo, ['remote']).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes('origin')) throw new Error('The relay repository needs an origin remote.');
    return repo;
  }

  async connect() {
    const choice = await this.dialog.showMessageBox({
      type: 'question', title: 'GitHub relay',
      message: '비공개 Runner 전달 저장소를 연결합니다.',
      detail: '기존 clone을 선택하거나 앱에 저장된 GitHub 자격 증명으로 새 비공개 저장소를 만드세요.',
      buttons: ['기존 저장소 선택', '새 비공개 저장소 생성', '취소'], defaultId: 0, cancelId: 2,
    });
    if (choice.response === 2) return null;
    let repo;
    if (choice.response === 0) {
      const selected = await this.dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (selected.canceled) return null;
      repo = this.validateRepo(selected.filePaths[0]);
    } else {
      const auth = this.githubAuth();
      if (!auth?.access_token) throw new Error('새 저장소를 만들려면 먼저 앱에서 GitHub에 로그인하세요.');
      const selected = await this.dialog.showOpenDialog({ title: '새 relay 저장소를 복제할 상위 폴더', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled) return null;
      const name = `grok-crew-relay-${randomUUID().slice(0, 8)}`;
      const target = join(selected.filePaths[0], name);
      if (existsSync(target)) throw new Error('The generated relay folder already exists.');
      const created = await this.githubRequest('/user/repos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, private: true, auto_init: true, description: 'Encrypted Grok Crew Desktop relay' }),
      });
      run('git', ['clone', created.clone_url, target], selected.filePaths[0], this.gitEnvironment());
      repo = this.validateRepo(target);
    }
    const remote = this.git(repo, ['remote', 'get-url', 'origin']);
    this.saveConfig({ schema: 'grok-crew.git-relay/v1', repo, remote, control_branch: 'control', connected_at: new Date().toISOString() });
    return { repo, remote, control_branch: 'control' };
  }

  commitFile(branch, filePath, contents, message) {
    const { repo } = this.config();
    const safePath = String(filePath).replaceAll('\\', '/');
    if (safePath.startsWith('/') || safePath.split('/').includes('..')) throw new Error('Unsafe relay path.');
    const worktreeRoot = resolve(this.worktreeRoot());
    mkdirSync(worktreeRoot, { recursive: true });
    const worktree = resolve(worktreeRoot, randomUUID());
    if (!isWithin(worktreeRoot, worktree)) throw new Error('Unsafe relay worktree path.');
    try {
      try { this.git(repo, ['fetch', 'origin', branch]); } catch { /* the branch may not exist yet */ }
      const localExists = Boolean(this.git(repo, ['branch', '--list', branch]));
      const remoteExists = Boolean(this.git(repo, ['branch', '-r', '--list', `origin/${branch}`]));
      if (localExists) this.git(repo, ['worktree', 'add', '--force', worktree, branch]);
      else if (remoteExists) this.git(repo, ['worktree', 'add', '--force', '-b', branch, worktree, `origin/${branch}`]);
      else this.git(repo, ['worktree', 'add', '--force', '-b', branch, worktree, 'HEAD']);
      const destination = resolve(worktree, safePath);
      if (!isWithin(worktree, destination)) throw new Error('Relay file leaves its worktree.');
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
      this.git(worktree, ['add', '--', safePath]);
      if (this.git(worktree, ['status', '--porcelain'])) {
        this.git(worktree, ['-c', 'user.name=Grok Crew Desktop', '-c', 'user.email=noreply@grok-crew.local', 'commit', '-m', message]);
        this.git(worktree, ['push', '-u', 'origin', branch]);
      }
    } finally {
      try { this.git(repo, ['worktree', 'remove', '--force', worktree]); } catch { /* clean up below */ }
      if (existsSync(worktree) && isWithin(worktreeRoot, worktree)) rmSync(worktree, { recursive: true, force: true });
      try { this.git(repo, ['worktree', 'prune']); } catch { /* best effort */ }
    }
    return { branch, path: safePath };
  }

  pushRequest(controlJobId, envelope) {
    return this.commitFile('control', `requests/${controlJobId}.request.json`, envelope, `control: queue ${controlJobId}`);
  }

  pushControl(controlJobId, envelope, command) {
    return this.commitFile('control', `controls/${controlJobId}.control.json`, envelope, `control: ${command} ${controlJobId}`);
  }

  imported() {
    if (!existsSync(this.importedPath())) return [];
    const value = JSON.parse(readFileSync(this.importedPath(), 'utf8'));
    return Array.isArray(value) ? value : [];
  }

  markImported(key) {
    const next = [...new Set([...this.imported(), key])].slice(-2_000);
    writeFileSync(this.importedPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }

  results(runnerIds) {
    const { repo } = this.config();
    this.git(repo, ['fetch', 'origin', '--prune']);
    const seen = new Set(this.imported());
    const values = [];
    for (const runnerId of runnerIds) {
      if (!/^[A-Za-z0-9._-]+$/.test(runnerId)) continue;
      const ref = `origin/runner/${runnerId}`;
      if (!this.git(repo, ['branch', '-r', '--list', ref])) continue;
      const names = this.git(repo, ['ls-tree', '-r', '--name-only', ref, '--', 'results']).split(/\r?\n/).filter((name) => name.endsWith('/result.json') || /\/event-\d+\.json$/.test(name));
      for (const name of names) {
        const key = `${ref}:${name}:${this.git(repo, ['rev-parse', `${ref}:${name}`])}`;
        if (seen.has(key)) continue;
        values.push({ key, runner_id: runnerId, name: basename(dirname(name)), kind: name.endsWith('/result.json') ? 'result' : 'event', envelope: JSON.parse(this.git(repo, ['show', `${ref}:${name}`])) });
      }
    }
    return values;
  }
}
