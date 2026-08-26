#!/usr/bin/env node
/** Report P3 local launch gates without inventing OAuth or signing credentials. */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
const studio = join(root, 'local_studio');
const venvPython = join(studio, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'py' : 'python3');
const pythonArgs = python === 'py' ? ['-3'] : [];

const probe = spawnSync(python, [...pythonArgs, '-c', 'from launch import launch_status; import json; print(json.dumps(launch_status()))'], {
  cwd: studio,
  encoding: 'utf8',
});
if (probe.status !== 0) {
  process.stderr.write(probe.stderr || probe.stdout || 'launch status failed\n');
  process.exit(probe.status || 1);
}

const status = JSON.parse(probe.stdout);
if (status.schema !== 'grok-crew.launch-status/v1') {
  throw new Error('Unexpected launch status schema.');
}

const local = Object.entries(status.local_gates || {});
const localFailed = local.filter(([, ready]) => !ready).map(([name]) => name);
const external = Object.entries(status.external_gates || {});

console.log(`Grok Crew ${status.app_version} launch verification`);
console.log('Local gates:');
for (const [name, ready] of local) {
  console.log(`  ${ready ? 'pass' : 'FAIL'}  ${name}`);
}
console.log('External gates (not implemented in this repo):');
for (const [name, gate] of external) {
  console.log(`  ${gate.ready ? 'ready' : 'external'}  ${name} — ${gate.detail}`);
}

if (localFailed.length) {
  console.error(`Local launch gates failed: ${localFailed.join(', ')}`);
  process.exit(1);
}
console.log('Local 1.0 gates passed. OAuth apps, code signing, and in-place auto-update stay external.');
