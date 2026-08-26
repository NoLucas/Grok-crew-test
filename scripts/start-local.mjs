#!/usr/bin/env node
/** Start the complete local video workspace on this computer only. */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const studioRoot = join(root, 'local_studio');
const npm = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];
const venvPython = join(studioRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`)));
  });
}

function available(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function findPython() {
  if (process.env.PYTHON) return { command: process.env.PYTHON, args: [] };
  const candidates = process.platform === 'win32'
    ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
  const found = candidates.find(({ command, args }) => available(command, [...args, '--version']));
  if (!found) throw new Error('Python 3.10 or newer is required. Install it, then run npm run local again.');
  return found;
}

async function studioHealth() {
  try {
    const response = await fetch('http://127.0.0.1:7214/health');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function waitForStudio() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await studioHealth()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Local Studio did not become ready on http://127.0.0.1:7214.');
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

function assertStudioBelongsToThisClone(health) {
  if (!health) return;
  const expectedWorkspace = join(studioRoot, 'workspace').replace(/\\/g, '/').toLowerCase();
  const activeWorkspace = String(health.workspace || '').replace(/\\/g, '/').toLowerCase();
  if (activeWorkspace !== expectedWorkspace) {
    throw new Error(`Port 7214 is already serving a different Grok Crew clone (${health.workspace || 'unknown workspace'}). Stop that Local Studio, then run npm run local again.`);
  }
}

function provisionBundledSample() {
  const source = join(root, 'public', 'demo', 'bot-edit-result-source.mp4');
  const destination = join(studioRoot, 'workspace', 'inputs', 'grok-crew-sample.mp4');
  if (!existsSync(source) || existsSync(destination)) return;
  mkdirSync(join(studioRoot, 'workspace', 'inputs'), { recursive: true });
  copyFileSync(source, destination);
  console.log('Bundled sample media is ready at local_studio/workspace/inputs/grok-crew-sample.mp4');
}

async function main() {
  if (!existsSync(join(root, 'node_modules'))) await run(npm, [...npmPrefix, 'ci']);
  provisionBundledSample();

  if (!await portIsFree(3000)) {
    throw new Error('Port 3000 is already in use. Stop the existing web workspace, then run npm run local again. Grok Crew always uses http://localhost:3000.');
  }
  assertStudioBelongsToThisClone(await studioHealth());

  const python = findPython();
  await run(python.command, [...python.args, '-c', "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'"]);
  if (!existsSync(venvPython)) await run(python.command, [...python.args, '-m', 'venv', join(studioRoot, '.venv')]);
  await run(venvPython, ['-m', 'pip', 'install', '-r', join(studioRoot, 'requirements.txt')]);

  let studio = null;
  const existingStudio = await studioHealth();
  assertStudioBelongsToThisClone(existingStudio);
  if (!existingStudio) {
    studio = spawn(venvPython, ['studio_server.py', '--port', '7214'], { cwd: studioRoot, stdio: 'inherit' });
    studio.on('error', (error) => console.error(`Local Studio could not start: ${error.message}`));
    await waitForStudio();
  }

  console.log('\nLocal Video Workspace is ready at http://localhost:3000/');
  console.log('Bots in this cloned folder can use: python local_studio/grok_crew.py contract\n');
  const web = spawn(npm, [...npmPrefix, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000', '--strictPort'], { cwd: root, stdio: 'inherit' });
  const close = () => { if (studio && !studio.killed) studio.kill(); if (!web.killed) web.kill(); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
  web.on('error', (error) => { console.error(`Local Video Workspace's dev server could not start: ${error.message}`); close(); process.exitCode = 1; });
  web.on('exit', (code) => { close(); process.exitCode = code ?? 1; });
}

main().catch((error) => { console.error(`\nCould not start Local Video Workspace: ${error.message}`); process.exitCode = 1; });
