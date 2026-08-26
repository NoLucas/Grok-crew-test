/** Shared first-run bootstrap for `npm run local` and `npm run desktop`. */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const studioRoot = join(root, 'local_studio');
const npm = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];
export const venvPython = join(studioRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const stampPath = join(studioRoot, '.venv', '.requirements.sha256');
const requirementsPath = join(studioRoot, 'requirements.txt');
const sampleSource = join(root, 'public', 'demo', 'bot-edit-result-source.mp4');
const sampleDestination = join(studioRoot, 'workspace', 'inputs', 'grok-crew-sample.mp4');

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`)));
  });
}

export function available(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

export function findPython() {
  if (process.env.PYTHON) return { command: process.env.PYTHON, args: [] };
  const candidates = process.platform === 'win32'
    ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
  const found = candidates.find(({ command, args }) => available(command, [...args, '--version']));
  if (!found) throw new Error('Python 3.10 or newer is required. Install it, then run npm run local again.');
  return found;
}

export function requirementsStamp(contents = readFileSync(requirementsPath)) {
  return createHash('sha256').update(contents).digest('hex');
}

export function requirementsAreCurrent() {
  if (!existsSync(venvPython) || !existsSync(stampPath)) return false;
  return readFileSync(stampPath, 'utf8').trim() === requirementsStamp();
}

export function provisionBundledSample() {
  if (!existsSync(sampleSource)) return false;
  if (existsSync(sampleDestination)) return true;
  mkdirSync(join(studioRoot, 'workspace', 'inputs'), { recursive: true });
  copyFileSync(sampleSource, sampleDestination);
  console.log('Bundled sample media is ready at local_studio/workspace/inputs/grok-crew-sample.mp4');
  return true;
}

export async function studioHealth(server = 'http://127.0.0.1:7214') {
  try {
    const response = await fetch(`${server.replace(/\/$/, '')}/health`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function waitForStudio(server = 'http://127.0.0.1:7214') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await studioHealth(server)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Local Studio did not become ready on http://127.0.0.1:7214.');
}

export function assertStudioBelongsToThisClone(health) {
  if (!health) return;
  const expectedWorkspace = join(studioRoot, 'workspace').replace(/\\/g, '/').toLowerCase();
  const activeWorkspace = String(health.workspace || '').replace(/\\/g, '/').toLowerCase();
  if (activeWorkspace !== expectedWorkspace) {
    throw new Error(`Port 7214 is already serving a different Grok Crew clone (${health.workspace || 'unknown workspace'}). Stop that Local Studio, then run npm run local again.`);
  }
}

export async function ensurePythonRuntime() {
  const python = findPython();
  await run(python.command, [...python.args, '-c', "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'"]);
  if (!existsSync(venvPython)) await run(python.command, [...python.args, '-m', 'venv', join(studioRoot, '.venv')]);
  if (requirementsAreCurrent()) {
    console.log('Python renderer is already installed. Skipping pip.');
    return;
  }
  await run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
  writeFileSync(stampPath, `${requirementsStamp()}\n`);
}

async function studioRequest(path, { method = 'GET', token = process.env.LOCAL_STUDIO_TOKEN || '', server = 'http://127.0.0.1:7214' } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  const response = await fetch(`${server.replace(/\/$/, '')}${path}`, { method, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
  return payload;
}

export async function openSampleIfEmpty({ server = 'http://127.0.0.1:7214', token = process.env.LOCAL_STUDIO_TOKEN || '' } = {}) {
  try {
    const workspace = await studioRequest('/api/v2/workspace', { token, server });
    if (workspace.projects?.length) return { opened: false, reused: false };
    const result = await studioRequest('/api/v2/first-run/sample', { method: 'POST', token, server });
    console.log(result.reused
      ? 'Sample project is already on the Desktop.'
      : 'Opened the bundled sample project on the Desktop.');
    return { opened: true, reused: Boolean(result.reused) };
  } catch (error) {
    console.log(`Sample project was not opened automatically: ${error instanceof Error ? error.message : error}`);
    return { opened: false, reused: false };
  }
}

export async function ensureLocalRuntime({ startStudio = true } = {}) {
  if (!existsSync(join(root, 'node_modules'))) await run(npm, [...npmPrefix, 'ci']);
  provisionBundledSample();
  await ensurePythonRuntime();

  let studio = null;
  if (startStudio) {
    const existingStudio = await studioHealth();
    assertStudioBelongsToThisClone(existingStudio);
    if (!existingStudio) {
      studio = spawn(venvPython, ['studio_server.py', '--port', '7214'], { cwd: studioRoot, stdio: 'inherit' });
      studio.on('error', (error) => console.error(`Local Studio could not start: ${error.message}`));
      await waitForStudio();
    }
    await openSampleIfEmpty();
  }

  return { studio };
}
