import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const preload = process.env.GROK_CREW_PRELOAD_PATH
  ? resolve(process.env.GROK_CREW_PRELOAD_PATH)
  : join(root, 'desktop', 'preload.cjs');
const apiBase = 'http://127.0.0.1:54321';

async function run() {
  console.log('Starting desktop preload smoke test.');
  console.log('Electron app is ready.');
  ipcMain.handle('desktop:app-info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));

  const runtime = Buffer.from(JSON.stringify({ apiBase })).toString('base64url');
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--grok-crew-runtime=${runtime}`],
    },
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload failed at ${preloadPath}:`, error);
  });

  await window.loadURL('data:text/html,<html><body>Grok Crew preload smoke test</body></html>');
  console.log('Smoke renderer loaded.');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const api = window.grokCrew;
    return {
      present: Boolean(api),
      apiBase: api?.apiBase,
      selectMedia: typeof api?.selectMedia,
      pairRunner: typeof api?.pairRunner,
      request: typeof api?.request,
      appInfo: await api?.appInfo(),
    };
  })()`);

  assert.equal(result.present, true, 'window.grokCrew was not exposed by the sandboxed preload.');
  assert.equal(result.apiBase, apiBase);
  assert.equal(result.selectMedia, 'function');
  assert.equal(result.pairRunner, 'function');
  assert.equal(result.request, 'function');
  assert.equal(result.appInfo.platform, process.platform);
  window.destroy();
  console.log('Desktop preload smoke test passed.');
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
