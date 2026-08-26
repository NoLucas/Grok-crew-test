#!/usr/bin/env node
/** Start the complete local video workspace on this computer only. */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { ensureLocalRuntime, root } from './local-runtime.mjs';

const npm = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function main() {
  if (!await portIsFree(3000)) {
    throw new Error('Port 3000 is already in use. Stop the existing web workspace, then run npm run local again. Grok Crew always uses http://localhost:3000.');
  }

  const { studio } = await ensureLocalRuntime({ startStudio: true });

  console.log('\nDesktop is ready at http://localhost:3000/');
  console.log('If the project list is empty, save a brief on the Grok door or the other-agent door. It goes in that door\'s outbox.');
  console.log('Bots in this cloned folder can use: python local_studio/grok_crew.py contract\n');
  const web = spawn(npm, [...npmPrefix, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000', '--strictPort'], { cwd: root, stdio: 'inherit' });
  const close = () => { if (studio && !studio.killed) studio.kill(); if (!web.killed) web.kill(); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
  web.on('error', (error) => { console.error(`The browser workspace could not start: ${error.message}`); close(); process.exitCode = 1; });
  web.on('exit', (code) => { close(); process.exitCode = code ?? 1; });
}

main().catch((error) => { console.error(`\nCould not start Local Video Workspace: ${error.message}`); process.exitCode = 1; });
