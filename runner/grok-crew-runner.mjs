#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import readline from 'node:readline';
import { createIdentity, openEnvelope, publicIdentity, sealEnvelope } from './crypto.mjs';

const EVENT_SCHEMA = 'grok-crew.runner-event/v1';
const PATCH_SCHEMA = 'grok-crew.timeline-patch/v1';
const NEEDS_INPUT_SCHEMA = 'grok-crew.runner-needs-input/v1';
const CONTROL_SCHEMA = 'grok-crew.runner-control/v1';

class RunnerControlSignal extends Error {
  constructor(control) {
    super(`Runner received ${control.command}.`);
    this.name = 'RunnerControlSignal';
    this.control = control;
  }
}

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function statePath() {
  return resolve(option('--state', process.env.GROK_CREW_RUNNER_STATE ?? join(process.cwd(), '.grok-crew-runner')));
}

function identityFile() { return join(statePath(), 'identity.json'); }
function peerFile() { return join(statePath(), 'desktop-public.json'); }

function savePrivate(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows ACLs are managed by the owner account */ }
}

function loadJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

function jobStateFile(jobId) { return join(statePath(), 'jobs', jobId, 'runner-state.json'); }
function loadJobState(jobId) {
  const path = jobStateFile(jobId);
  return existsSync(path) ? loadJson(path) : { last_event_sequence: 0, last_control_sequence: 0, attempts: [] };
}
function saveJobState(jobId, value) { savePrivate(jobStateFile(jobId), value); }

function git(repo, args) {
  try { return execFileSync('git', ['-C', repo, ...args], { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { throw new Error(String(error?.stderr ?? error?.stdout ?? error?.message ?? error).trim() || 'git failed.'); }
}

function isWithin(root, candidate) {
  const rootPath = resolve(root); const target = resolve(candidate);
  return target === rootPath || target.startsWith(`${rootPath}${sep}`);
}

function emit(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

function init() {
  if (existsSync(identityFile())) throw new Error(`Runner identity already exists at ${identityFile()}.`);
  const id = option('--runner-id', `runner-${randomUUID().slice(0, 8)}`);
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('runner-id may contain only letters, numbers, dot, underscore, and hyphen.');
  const identity = createIdentity(id);
  savePrivate(identityFile(), identity);
  const publicValue = { schema: 'grok-crew.runner-pairing/v1', display_name: option('--name', id), ...publicIdentity(identity) };
  writeFileSync(join(statePath(), 'runner-pairing.json'), `${JSON.stringify(publicValue, null, 2)}\n`);
  emit({ ok: true, pairing_file: join(statePath(), 'runner-pairing.json'), runner: publicValue });
}

function trustDesktop() {
  const source = option('--desktop-public');
  if (!source) throw new Error('--desktop-public is required.');
  const value = loadJson(resolve(source));
  if (!value.id || !value.signing_public_key || !value.encryption_public_key) throw new Error('Invalid desktop public identity.');
  savePrivate(peerFile(), value);
  emit({ ok: true, trusted_desktop: value.id });
}

function collectText(value, chunks) {
  if (typeof value === 'string') { chunks.push(value); return; }
  if (Array.isArray(value)) { for (const item of value) collectText(item, chunks); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['text', 'delta', 'content', 'message'].includes(key)) collectText(child, chunks);
  }
}

function parseResponse(text, baseRevision) {
  const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  candidates.push(text);
  for (const candidate of candidates.reverse()) {
    const starts = [...candidate.matchAll(/\{/g)].map((match) => match.index ?? 0).reverse();
    for (const start of starts) {
      try {
        const parsed = JSON.parse(candidate.slice(start));
        if (parsed.schema === PATCH_SCHEMA && Array.isArray(parsed.operations)) return { ...parsed, base_revision: baseRevision, origin: 'remote_bot', created_by: 'grok-build-runner' };
        if (parsed.schema === NEEDS_INPUT_SCHEMA && typeof parsed.question === 'string' && Array.isArray(parsed.options) && parsed.options.length >= 2) {
          return {
            schema: NEEDS_INPUT_SCHEMA,
            question_id: String(parsed.question_id ?? 'creative-decision').slice(0, 120),
            question: parsed.question.slice(0, 2_000),
            options: parsed.options.slice(0, 6).map((item) => typeof item === 'string' ? { value: item, label: item } : { value: String(item.value ?? item.label), label: String(item.label ?? item.value), description: String(item.description ?? '') }),
          };
        }
      } catch { /* look for the previous JSON object */ }
    }
  }
  throw new Error('Grok did not return a valid timeline patch or structured input request.');
}

function terminateChild(child) {
  if (!child || child.exitCode != null || child.killed) return false;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); return true; }
    catch { try { return child.kill(); } catch { return false; } }
  }
  try { return child.kill('SIGTERM'); } catch { return false; }
}

async function waitWithControls(delayMs, pollControl) {
  const deadline = Date.now() + delayMs;
  while (Date.now() < deadline) {
    const control = pollControl ? await pollControl() : null;
    if (control && ['cancel', 'pause'].includes(control.command)) throw new RunnerControlSignal(control);
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(150, Math.max(1, deadline - Date.now()))));
  }
}

async function runGrok(payload, workingDirectory, onStage, pollControl) {
  const fixture = option('--fixture-output');
  if (fixture) {
    const delay = Math.max(0, Number(option('--fixture-delay-ms', '0')) || 0);
    if (delay) await waitWithControls(delay, pollControl);
    return parseResponse(readFileSync(resolve(fixture), 'utf8'), payload.control_job.base_revision);
  }
  const prompt = [
    'You are the remote planning half of Grok Crew Desktop.',
    'Return exactly one JSON object using schema grok-crew.timeline-patch/v1.',
    'Use only asset IDs and timecodes. Never invent or output local filesystem paths.',
    'Do not modify locked tracks or clips. If a creative decision is missing, return grok-crew.runner-needs-input/v1 with question_id, question, and 2–6 {value,label,description} options instead.',
    `Editing package:\n${JSON.stringify(payload, null, 2)}`,
  ].join('\n\n');
  const command = process.env.GROK_RUNNER_COMMAND ?? 'grok';
  let prefixArgs = [];
  if (process.env.GROK_RUNNER_PREFIX_ARGS) {
    try {
      const parsed = JSON.parse(process.env.GROK_RUNNER_PREFIX_ARGS);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('not a string array');
      prefixArgs = parsed;
    } catch { throw new Error('GROK_RUNNER_PREFIX_ARGS must be a JSON string array.'); }
  }
  const args = [...prefixArgs,
    '--no-auto-update', '-p', prompt, '--cwd', workingDirectory,
    '--output-format', 'streaming-json', '--sandbox', 'workspace',
    '--disallowed-tools', 'Bash,Edit,Write,WebFetch,WebSearch',
    '--max-turns', '4', '--no-subagents', '--disable-web-search',
    '--session-id', payload.control_job.id,
  ];
  await onStage('analyzing', 'active', { message: 'Grok Build started.' });
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: workingDirectory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks = [];
    const errors = [];
    let settled = false;
    let polling = false;
    const controlTimer = pollControl ? setInterval(async () => {
      if (settled || polling) return;
      polling = true;
      try {
        const control = await pollControl();
        if (control && ['cancel', 'pause'].includes(control.command)) {
          const terminated = terminateChild(child);
          settled = true;
          clearInterval(controlTimer);
          rejectRun(new RunnerControlSignal({ ...control, process_terminated: terminated, process_was_running: true }));
        }
      } catch (error) {
        if (error instanceof RunnerControlSignal) {
          settled = true; clearInterval(controlTimer); rejectRun(error);
        }
      } finally { polling = false; }
    }, 750) : null;
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try { collectText(JSON.parse(line), chunks); } catch { chunks.push(line); }
    });
    child.stderr.on('data', (chunk) => errors.push(String(chunk)));
    child.on('error', (error) => { if (!settled) { settled = true; if (controlTimer) clearInterval(controlTimer); rejectRun(error); } });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (controlTimer) clearInterval(controlTimer);
      if (code !== 0) { rejectRun(new Error(errors.join('').trim() || `Grok exited with ${code}.`)); return; }
      try { resolveRun(parseResponse(chunks.join('\n'), payload.control_job.base_revision)); }
      catch (error) { rejectRun(error); }
    });
  });
}

async function runFile(paths = {}) {
  const requestValue = paths.requestPath ?? option('--request');
  if (!requestValue) throw new Error('--request is required.');
  const requestPath = resolve(requestValue);
  const outputDir = resolve(paths.outputDir ?? option('--output', join(dirname(requestPath), 'response')));
  const identity = loadJson(identityFile());
  const desktop = loadJson(peerFile());
  const envelope = loadJson(requestPath);
  const payload = openEnvelope(envelope, identity, desktop);
  const jobId = String(payload.control_job?.id ?? '');
  if (!/^[A-Za-z0-9._-]+$/.test(jobId) || payload.schema !== 'grok-crew.runner-request/v1') throw new Error('Invalid runner request payload.');
  const attempt = Math.max(1, Number(payload.control_job?.attempt ?? 1) || 1);
  const fingerprint = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  mkdirSync(outputDir, { recursive: true });
  const persisted = loadJobState(jobId);
  let sequence = Math.max(0, Number(persisted.last_event_sequence ?? 0) || 0);
  const writeEvent = async (stage, status, detail = {}) => {
    sequence += 1;
    const eventDetail = { ...detail, attempt };
    const event = { schema: EVENT_SCHEMA, control_job_id: jobId, runner_id: identity.id, sequence, stage, status, detail: eventDetail, verified_at: new Date().toISOString(), request_fingerprint: fingerprint };
    const eventPath = join(outputDir, `event-${String(sequence).padStart(4, '0')}.json`);
    writeFileSync(eventPath, `${JSON.stringify(sealEnvelope(event, identity, desktop), null, 2)}\n`);
    saveJobState(jobId, { ...loadJobState(jobId), last_event_sequence: sequence, last_request_fingerprint: fingerprint, last_attempt: attempt });
    if (paths.onEvent) await paths.onEvent({ event, eventPath, outputDir, control_job_id: jobId });
  };
  try {
    await writeEvent('claimed', 'active', { message: 'Runner claimed the signed request.' });
    if (paths.pollControl) {
      const initialControl = await paths.pollControl(jobId, attempt);
      if (initialControl && ['cancel', 'pause'].includes(initialControl.command)) throw new RunnerControlSignal({ ...initialControl, process_terminated: true, process_was_running: false });
      if (initialControl && ['resume', 'retry'].includes(initialControl.command)) {
        await writeEvent('resumed', 'active', { command: initialControl.command, control_sequence: Number(initialControl.sequence) });
      }
    }
    const work = join(statePath(), 'jobs', jobId, `attempt-${attempt}`);
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'editing-package.json'), `${JSON.stringify(payload, null, 2)}\n`);
    const proposal = await runGrok(payload, work, writeEvent, paths.pollControl ? () => paths.pollControl(jobId, attempt) : null);
    const needsInput = proposal.schema === NEEDS_INPUT_SCHEMA;
    if (needsInput) await writeEvent('needs_input', 'waiting', proposal);
    else await writeEvent('proposal_ready', 'succeeded', { operation_count: proposal.operations.length });
    const result = {
      schema: 'grok-crew.runner-result/v1', control_job_id: jobId, runner_id: identity.id,
      base_revision: payload.control_job.base_revision,
      attempt,
      ...(needsInput ? { outcome: 'needs_input', needs_input: proposal } : { outcome: 'timeline_patch', timeline_patch: proposal }),
      completed_at: new Date().toISOString(), request_fingerprint: fingerprint, terminal_sequence: sequence,
    };
    writeFileSync(join(outputDir, 'result.json'), `${JSON.stringify(sealEnvelope(result, identity, desktop), null, 2)}\n`);
    if (!needsInput) await writeEvent('completed', 'succeeded', { result: 'result.json' });
    emit({ ok: true, control_job_id: jobId, output: outputDir });
    return { control_job_id: jobId, output: outputDir };
  } catch (error) {
    if (error instanceof RunnerControlSignal) {
      const command = error.control.command;
      const outcome = command === 'pause' ? 'paused' : 'cancelled';
      const receipt = {
        schema: 'grok-crew.runner-control-receipt/v1', command,
        sequence: Number(error.control.sequence), attempt,
        received_at: new Date().toISOString(), process_terminated: error.control.process_terminated !== false,
        process_was_running: Boolean(error.control.process_was_running),
        request_fingerprint: fingerprint,
      };
      await writeEvent(outcome, command === 'pause' ? 'waiting' : 'cancelled', receipt);
      const result = {
        schema: 'grok-crew.runner-result/v1', control_job_id: jobId, runner_id: identity.id,
        base_revision: payload.control_job.base_revision, attempt, outcome,
        control_receipt: receipt, completed_at: new Date().toISOString(),
        request_fingerprint: fingerprint, terminal_sequence: sequence,
      };
      writeFileSync(join(outputDir, 'result.json'), `${JSON.stringify(sealEnvelope(result, identity, desktop), null, 2)}\n`);
      emit({ ok: true, control_job_id: jobId, output: outputDir, outcome });
      return { control_job_id: jobId, output: outputDir, outcome };
    }
    await writeEvent('failed', 'failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function processedFile() { return join(statePath(), 'processed-requests.json'); }
function processedRequests() { return existsSync(processedFile()) ? loadJson(processedFile()) : []; }

function commitRunnerOutput(repo, identity, output, controlJobId, message) {
  const branch = `runner/${identity.id}`;
  try { git(repo, ['fetch', 'origin', branch]); } catch { /* first response on this branch */ }
  const worktreeRoot = resolve(statePath(), 'git-worktrees');
  mkdirSync(worktreeRoot, { recursive: true });
  const worktree = resolve(worktreeRoot, randomUUID());
  if (!isWithin(worktreeRoot, worktree)) throw new Error('Unsafe Runner worktree.');
  try {
    const localExists = Boolean(git(repo, ['branch', '--list', branch]));
    const remoteExists = Boolean(git(repo, ['branch', '-r', '--list', `origin/${branch}`]));
    if (localExists) git(repo, ['worktree', 'add', '--force', worktree, branch]);
    else if (remoteExists) git(repo, ['worktree', 'add', '--force', '-b', branch, worktree, `origin/${branch}`]);
    else git(repo, ['worktree', 'add', '--force', '-b', branch, worktree, 'HEAD']);
    const destination = resolve(worktree, 'results', controlJobId);
    if (!isWithin(worktree, destination)) throw new Error('Unsafe Git result path.');
    mkdirSync(destination, { recursive: true });
    cpSync(output, destination, { recursive: true, force: true });
    git(worktree, ['add', '--', `results/${controlJobId}`]);
    if (git(worktree, ['status', '--porcelain'])) {
      git(worktree, ['-c', `user.name=Grok Crew ${identity.id}`, '-c', 'user.email=noreply@grok-crew.local', 'commit', '-m', message]);
      git(worktree, ['push', '-u', 'origin', branch]);
    }
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', worktree]); } catch { /* clean below */ }
    if (existsSync(worktree) && isWithin(worktreeRoot, worktree)) rmSync(worktree, { recursive: true, force: true });
    try { git(repo, ['worktree', 'prune']); } catch { /* best effort */ }
  }
  return branch;
}

function latestControl(repo, identity, desktop, jobId, attempt) {
  try { git(repo, ['fetch', 'origin', 'control']); } catch { return null; }
  const ref = git(repo, ['branch', '-r', '--list', 'origin/control']) ? 'origin/control' : 'control';
  const name = `controls/${jobId}.control.json`;
  try { git(repo, ['cat-file', '-e', `${ref}:${name}`]); } catch { return null; }
  const envelope = JSON.parse(git(repo, ['show', `${ref}:${name}`]));
  const control = openEnvelope(envelope, identity, desktop);
  if (control.schema !== CONTROL_SCHEMA || control.control_job_id !== jobId || control.runner_id !== identity.id) throw new Error('Invalid Runner control envelope.');
  const state = loadJobState(jobId);
  const sequence = Number(control.sequence ?? 0);
  if (sequence < 1 || sequence <= Number(state.last_control_sequence ?? 0)) return null;
  if (Number(control.attempt ?? 1) < attempt) return null;
  if (!['cancel', 'pause', 'resume', 'retry'].includes(control.command)) throw new Error('Unsupported Runner control command.');
  saveJobState(jobId, { ...state, last_control_sequence: sequence, last_control_command: control.command, last_control_at: new Date().toISOString() });
  return control;
}

async function runRepositoryOnce() {
  const repoValue = option('--repo');
  if (!repoValue) throw new Error('--repo is required.');
  const repo = resolve(repoValue);
  if (!existsSync(join(repo, '.git'))) throw new Error('--repo must point to a dedicated Git relay clone.');
  const identity = loadJson(identityFile());
  git(repo, ['fetch', 'origin', 'control']);
  const ref = git(repo, ['branch', '-r', '--list', 'origin/control']) ? 'origin/control' : 'control';
  const names = git(repo, ['ls-tree', '-r', '--name-only', ref, '--', 'requests']).split(/\r?\n/).filter((name) => name.endsWith('.request.json'));
  const processed = new Set(processedRequests());
  let completed = 0;
  for (const name of names) {
    const requestKey = `${name}:${git(repo, ['rev-parse', `${ref}:${name}`])}`;
    if (processed.has(requestKey)) continue;
    if (name.split('/').includes('..')) throw new Error('Unsafe request path in relay repository.');
    const inbox = resolve(statePath(), 'inbox');
    mkdirSync(inbox, { recursive: true });
    const requestPath = resolve(inbox, basename(name));
    if (!isWithin(inbox, requestPath)) throw new Error('Unsafe local request path.');
    writeFileSync(requestPath, git(repo, ['show', `${ref}:${name}`]));
    const jobName = basename(name, '.request.json');
    const outbox = resolve(statePath(), 'outbox');
    const output = resolve(outbox, jobName);
    if (!isWithin(outbox, output)) throw new Error('Unsafe local output path.');
    const result = await runFile({
      requestPath, outputDir: output,
      onEvent: ({ event }) => commitRunnerOutput(repo, identity, output, event.control_job_id, `runner: ${event.stage} ${event.control_job_id}`),
      pollControl: (activeJobId, activeAttempt) => latestControl(repo, identity, loadJson(peerFile()), activeJobId, activeAttempt),
    });
    commitRunnerOutput(repo, identity, output, result.control_job_id, `runner: complete ${result.control_job_id}`);
    processed.add(requestKey);
    savePrivate(processedFile(), [...processed]);
    completed += 1;
  }
  emit({ ok: true, checked: names.length, completed, branch: `runner/${identity.id}` });
  return completed;
}

async function runRepository() {
  const watch = process.argv.includes('--watch');
  do {
    await runRepositoryOnce();
    if (watch) await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(1, Number(option('--interval', '5'))) * 1_000));
  } while (watch);
}

async function main() {
  const command = process.argv[2];
  if (command === 'init') init();
  else if (command === 'trust-desktop') trustDesktop();
  else if (command === 'run-file') await runFile();
  else if (command === 'run-repo') await runRepository();
  else throw new Error('Usage: grok-crew-runner <init|trust-desktop|run-file|run-repo> [options]');
}

main().catch((error) => { emit({ ok: false, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; });
