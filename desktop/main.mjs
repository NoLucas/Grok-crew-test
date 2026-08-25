import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RelayService } from './relay-service.mjs';
import { createDesktopTray, installCloseToTray } from './tray-controller.mjs';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(desktopDir, '..');
const development = !app.isPackaged;
let studioProcess = null;
let rendererServer = null;
let studioPort = 0;
let studioToken = '';
let mainWindow = null;
let tray = null;
let quitting = false;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function quitApplication() {
  quitting = true;
  app.quit();
}

function createTray() {
  if (tray) return tray;
  tray = createDesktopTray({ show: showMainWindow, hide: hideMainWindow, quit: quitApplication });
  return tray;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function developmentPython() {
  const venv = join(root, 'local_studio', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (existsSync(venv)) return { command: venv, args: [join(root, 'local_studio', 'studio_server.py')] };
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const command of candidates) {
    const probe = spawnSync(command, command === 'py' ? ['-3', '--version'] : ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return { command, args: [...(command === 'py' ? ['-3'] : []), join(root, 'local_studio', 'studio_server.py')] };
  }
  throw new Error('Python sidecar is unavailable. Run npm run local once or build the packaged sidecar.');
}

async function waitForStudio(apiBase) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/health`);
      if (response.ok) return;
    } catch { /* sidecar is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error('The local video sidecar did not become ready.');
}

async function startStudio() {
  studioPort = await freePort();
  studioToken = randomBytes(32).toString('base64url');
  const apiBase = `http://127.0.0.1:${studioPort}`;
  const e2eRoot = development && process.env.GROK_CREW_E2E_ROOT
    ? resolve(process.env.GROK_CREW_E2E_ROOT)
    : null;
  const dataRoot = e2eRoot ? join(e2eRoot, 'studio-data') : join(app.getPath('userData'), 'studio-data');
  const workspace = e2eRoot ? join(e2eRoot, 'workspace') : join(app.getPath('videos'), 'Grok Crew');
  const environment = {
    ...process.env,
    LOCAL_STUDIO_TOKEN: studioToken,
    LOCAL_STUDIO_DATA: dataRoot,
    LOCAL_STUDIO_WORKSPACE: workspace,
    LOCAL_STUDIO_ALLOWED_ORIGINS: process.env.GROK_CREW_RENDERER_URL ?? 'http://127.0.0.1:3000',
  };
  if (development) {
    const python = developmentPython();
    studioProcess = spawn(python.command, [...python.args, '--port', String(studioPort)], {
      cwd: join(root, 'local_studio'), env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } else {
    const executable = join(process.resourcesPath, 'sidecar', process.platform === 'win32' ? 'grok-crew-studio.exe' : 'grok-crew-studio');
    if (!existsSync(executable)) throw new Error(`Packaged sidecar is missing: ${executable}`);
    studioProcess = spawn(executable, ['--port', String(studioPort)], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  }
  studioProcess.stdout?.on('data', (chunk) => console.log(`[studio] ${String(chunk).trimEnd()}`));
  studioProcess.stderr?.on('data', (chunk) => console.error(`[studio] ${String(chunk).trimEnd()}`));
  studioProcess.once('exit', (code) => { if (!app.isQuitting && code) console.error(`Local Studio exited with ${code}.`); });
  await waitForStudio(apiBase);
  return apiBase;
}

async function startRenderer() {
  if (process.env.GROK_CREW_RENDERER_URL) return process.env.GROK_CREW_RENDERER_URL;
  const port = await freePort();
  const { startProdServer } = await import('vinext/server/prod-server');
  const started = await startProdServer({
    port, host: '127.0.0.1', outDir: join(development ? root : app.getAppPath(), 'dist'),
    purpose: 'Grok Crew renderer', silent: true,
  });
  rendererServer = started.server;
  return `http://127.0.0.1:${started.port}`;
}

function registerIpc(apiBase) {
  const request = async (path, value = {}) => {
    const method = String(value?.method ?? 'GET').toUpperCase();
    const body = value?.body == null ? undefined : String(value.body);
    if (!path.startsWith('/api/') || path.includes('://') || !['GET', 'POST', 'PATCH'].includes(method)) throw new Error('Blocked Studio IPC request.');
    if (body && Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('Studio IPC body is too large.');
    const response = await fetch(`${apiBase}${path}`, {
      method, body, headers: { Authorization: `Bearer ${studioToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(String(payload.error ?? `Local Studio ${response.status}`));
    return payload;
  };
  ipcMain.handle('studio:request', async (_event, value) => request(String(value?.path ?? ''), value));
  ipcMain.handle('timeline:apply-patch', async (_event, projectId, timelinePatch) => {
    const safeProjectId = String(projectId ?? '').trim();
    if (!safeProjectId || safeProjectId.length > 120 || !/^[A-Za-z0-9_.-]+$/.test(safeProjectId)) {
      return {
        ok: false, status: 0,
        error: { code: 'invalid_project_id', message: 'A valid project ID is required.', details: {} },
      };
    }
    if (!timelinePatch || typeof timelinePatch !== 'object' || Array.isArray(timelinePatch)) {
      return {
        ok: false, status: 0,
        error: { code: 'invalid_patch', message: 'Timeline patch must be an object.', details: {} },
      };
    }
    try {
      const patchBody = JSON.stringify(timelinePatch);
      if (Buffer.byteLength(patchBody) > 2 * 1024 * 1024) {
        return {
          ok: false, status: 0,
          error: { code: 'timeline_patch_too_large', message: 'Timeline patch is too large.', details: { maximum_bytes: 2 * 1024 * 1024 } },
        };
      }
      const response = await fetch(`${apiBase}/api/v2/projects/${safeProjectId}/timeline/patch`, {
        method: 'POST',
        body: patchBody,
        headers: { Authorization: `Bearer ${studioToken}`, 'Content-Type': 'application/json' },
      });
      const payload = await response.json();
      if (response.ok) return { ok: true, status: response.status, value: payload };
      return {
        ok: false,
        status: response.status,
        error: {
          code: String(payload.code ?? 'timeline_patch_failed'),
          message: String(payload.error ?? `Local Studio ${response.status}`),
          details: payload.details && typeof payload.details === 'object' ? payload.details : {},
        },
      };
    } catch {
      return {
        ok: false, status: 0,
        error: { code: 'timeline_patch_transport_error', message: 'The local editing service is unavailable.', details: {} },
      };
    }
  });
  ipcMain.handle('desktop:select-media', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const inputs = resolve(app.getPath('videos'), 'Grok Crew', 'inputs');
    mkdirSync(inputs, { recursive: true });
    const extension = extname(source);
    const stem = basename(source, extension).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'media';
    let fileName = `${stem}${extension.toLowerCase()}`;
    let suffix = 2;
    while (existsSync(join(inputs, fileName))) { fileName = `${stem}-${suffix}${extension.toLowerCase()}`; suffix += 1; }
    copyFileSync(source, join(inputs, fileName));
    return `inputs/${fileName}`;
  });
  ipcMain.handle('desktop:show-output', async (_event, relativePath) => {
    const target = resolve(app.getPath('videos'), 'Grok Crew', String(relativePath ?? ''));
    const rootPath = resolve(app.getPath('videos'), 'Grok Crew');
    if (target !== rootPath && !target.startsWith(`${rootPath}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Output path leaves the app workspace.');
    return shell.showItemInFolder(target);
  });
  ipcMain.handle('desktop:app-info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));
  const relay = new RelayService({ request, safeStorage, dialog, shell, clipboard, userData: app.getPath('userData'), documents: app.getPath('documents') });
  ipcMain.handle('relay:pair-runner', () => relay.pairRunner());
  ipcMain.handle('relay:export-desktop-pairing', () => relay.exportDesktopPairing());
  ipcMain.handle('relay:export-request', (_event, controlJobId) => relay.exportRequest(String(controlJobId ?? '')));
  ipcMain.handle('relay:import-result', () => relay.importResult());
  ipcMain.handle('relay:answer-input', (_event, controlJobId, answer) => relay.answerInput(String(controlJobId ?? ''), answer));
  ipcMain.handle('relay:connect-git', () => relay.connectGitRelay());
  ipcMain.handle('relay:github-status', () => relay.githubStatus());
  ipcMain.handle('relay:github-login-device', () => relay.loginGitHubDevice());
  ipcMain.handle('relay:github-login-token', (_event, token) => relay.loginGitHubToken(String(token ?? '')));
  ipcMain.handle('relay:push-git-request', (_event, controlJobId) => relay.pushGitRequest(String(controlJobId ?? '')));
  ipcMain.handle('relay:pull-git-results', () => relay.pullGitResults());
  ipcMain.handle('relay:control-job', (_event, controlJobId, command, reason) => relay.controlJob(String(controlJobId ?? ''), String(command ?? ''), String(reason ?? '')));
  ipcMain.handle('relay:resolve-conflict', (_event, controlJobId, action) => relay.resolveConflict(String(controlJobId ?? ''), String(action ?? '')));
}

async function createWindow(apiBase, rendererUrl) {
  const runtime = Buffer.from(JSON.stringify({ apiBase })).toString('base64url');
  const window = new BrowserWindow({
    width: 1500, height: 980, minWidth: 1060, minHeight: 720, backgroundColor: '#f4f4f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(desktopDir, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, additionalArguments: [`--grok-crew-runtime=${runtime}`],
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererUrl)) event.preventDefault();
  });
  mainWindow = window;
  window.on('query-session-end', () => { quitting = true; });
  installCloseToTray(window, () => quitting);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  await window.loadURL(rendererUrl);
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(async () => {
    try {
      const rendererUrl = await startRenderer();
      process.env.GROK_CREW_RENDERER_URL = rendererUrl;
      const apiBase = await startStudio();
      registerIpc(apiBase);
      await createWindow(apiBase, rendererUrl);
      createTray();
    } catch (error) {
      dialog.showErrorBox('Grok Crew could not start', error instanceof Error ? error.message : String(error));
      quitApplication();
    }
  });
}
app.on('activate', showMainWindow);
app.on('before-quit', () => {
  quitting = true;
  app.isQuitting = true;
  if (studioProcess && !studioProcess.killed) studioProcess.kill();
  if (rendererServer) rendererServer.close();
});
