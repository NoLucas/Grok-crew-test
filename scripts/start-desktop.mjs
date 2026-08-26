import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { ensureLocalRuntime, root } from './local-runtime.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electron = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const shell = process.platform === 'win32';

await ensureLocalRuntime({ startStudio: false });

const web = spawn(npm, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000', '--strictPort'], { cwd: root, stdio: 'inherit', shell });

function webReady() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

for (let attempt = 0; attempt < 80 && !(await webReady()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
if (!(await webReady())) { web.kill(); throw new Error('Renderer did not start on port 3000.'); }

const desktop = spawn(electron, ['desktop/main.mjs'], {
  cwd: root, stdio: 'inherit', shell,
  env: { ...process.env, GROK_CREW_RENDERER_URL: 'http://127.0.0.1:3000' },
});
const close = () => { if (!desktop.killed) desktop.kill(); if (!web.killed) web.kill(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
desktop.on('exit', (code) => { if (!web.killed) web.kill(); process.exitCode = code ?? 0; });
