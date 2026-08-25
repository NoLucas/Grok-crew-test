#!/usr/bin/env node
/** Render the bundled two-clip sample through the running local Studio. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = (process.env.GROK_CREW_SERVER || 'http://127.0.0.1:7214').replace(/\/$/, '');
const token = process.env.LOCAL_STUDIO_TOKEN || '';
const sampleInput = join(root, 'local_studio', 'workspace', 'inputs', 'grok-crew-sample.mp4');
const sampleOutput = join(root, 'local_studio', 'workspace', 'outputs', 'grok-crew-sample-render.mp4');
const manifestPath = join(root, 'sample-project', 'grok-crew-sample.project.json');
const expectedWorkspace = join(root, 'local_studio', 'workspace').replace(/\\/g, '/').toLowerCase();

function assertLoopbackServer() {
  const parsed = new URL(server);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('GROK_CREW_SERVER must be a local http://127.0.0.1 or http://localhost address.');
  }
}

async function request(path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${server}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Local Studio is not running. Start it in another terminal with npm run local, then run npm run sample again.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    const tokenHint = response.status === 401 ? ' Set LOCAL_STUDIO_TOKEN in this terminal if you protected Local Studio with a token.' : '';
    throw new Error(`Local Studio rejected the sample: ${detail}.${tokenHint}`);
  }
  return payload;
}

async function main() {
  assertLoopbackServer();
  if (!existsSync(sampleInput)) {
    throw new Error('The bundled input is missing. Run npm run local once so it can prepare local_studio/workspace/inputs/grok-crew-sample.mp4.');
  }
  if (!existsSync(manifestPath)) throw new Error('The sample-project manifest is missing from this clone.');

  const health = await request('/health');
  const activeWorkspace = String(health.workspace || '').replace(/\\/g, '/').toLowerCase();
  if (activeWorkspace !== expectedWorkspace) {
    throw new Error(`The Local Studio at ${server} belongs to a different Grok Crew clone (${health.workspace || 'unknown workspace'}). Stop it and run npm run local from this clone.`);
  }
  const projectPayload = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const botId = 'grok-crew-sample';
  await request('/api/bot-entry', {
    bot_id: botId,
    display_name: 'Grok Crew Sample',
    purpose: 'edit_video',
    task: 'Render the bundled two-clip local sample. No upload.',
    execution_mode: 'auto_local',
  });
  const created = await request('/api/projects', projectPayload);
  const project = created.project;
  if (!project?.id) throw new Error('Local Studio did not return a sample project ID.');
  const queued = await request(`/api/projects/${project.id}/render`, {
    bot_id: botId,
    requested_by: 'sample-project',
    run_immediately: true,
    wait: true,
  });
  const job = queued.job;
  if (job?.status !== 'succeeded') {
    throw new Error(`The sample render did not finish successfully${job?.error_text ? `: ${job.error_text}` : '.'}`);
  }

  console.log('\nSample render complete.');
  console.log(`Project: ${project.title} (${project.id})`);
  console.log(`MP4: ${sampleOutput}`);
  console.log('No Instagram job was created. Open http://localhost:3000/production or /bots to inspect the real local records.\n');
}

main().catch((error) => {
  console.error(`\nCould not render the sample: ${error.message}`);
  process.exitCode = 1;
});
