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
function printStructured(gate) {
  const apps = gate.apps || gate.providers;
  if (apps && typeof apps === 'object') {
    for (const [app, info] of Object.entries(apps)) {
      if (!info || typeof info !== 'object') continue;
      const flags = [];
      for (const [key, value] of Object.entries(info)) {
        if (typeof value === 'boolean') flags.push(`${key}=${value}`);
        else if (key === 'status' && typeof value === 'string') flags.push(`status=${value}`);
      }
      const detail = typeof info.detail === 'string' ? ` — ${info.detail}` : '';
      console.log(`    ${app}: ${flags.join(' ')}${detail}`);
    }
  }
  if (gate.env_present && typeof gate.env_present === 'object') {
    const names = Object.entries(gate.env_present)
      .map(([key, present]) => `${key}=${present ? 'present' : 'missing'}`)
      .join(', ');
    console.log(`    env: ${names}`);
  }
  if (Array.isArray(gate.missing_env) && gate.missing_env.length) {
    console.log(`    missing_env: ${gate.missing_env.join(', ')}`);
  }
  if (typeof gate.builder_notarize === 'boolean') {
    console.log(`    builder_notarize=${gate.builder_notarize}`);
  }
}

console.log('External gates (not implemented in this repo):');
for (const [name, gate] of external) {
  console.log(`  ${gate.ready ? 'ready' : 'external'}  ${name} — ${gate.detail}`);
  printStructured(gate);
}

if (localFailed.length) {
  console.error(`Local launch gates failed: ${localFailed.join(', ')}`);
  process.exit(1);
}
console.log('Local 1.0 gates passed. OAuth apps, code signing, and in-place auto-update stay external.');
