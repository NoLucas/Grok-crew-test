import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createIdentity, openEnvelope, publicIdentity, sealEnvelope } from '../runner/crypto.mjs';
import { GitRelay } from '../desktop/git-relay.mjs';
import { RelayService } from '../desktop/relay-service.mjs';

const desktop = createIdentity('desktop-test');
const runner = createIdentity('runner-test');
const payload = { schema: 'grok-crew.runner-request/v1', secret: 'transcript text', control_job: { id: 'job-1', base_revision: 4 } };
const envelope = sealEnvelope(payload, desktop, publicIdentity(runner));
assert.deepEqual(openEnvelope(envelope, runner, publicIdentity(desktop)), payload);
const replacement = envelope.ciphertext.endsWith('A') ? 'B' : 'A';
const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}${replacement}` };
assert.throws(() => openEnvelope(tampered, runner, publicIdentity(desktop)), /signature/);

const temporaryRoot = resolve('tmp');
mkdirSync(temporaryRoot, { recursive: true });
const temporary = mkdtempSync(join(temporaryRoot, 'grok-crew-relay-test-'));
try {
  const runnerScript = resolve('runner/grok-crew-runner.mjs');
  const fixture = resolve('runner/fixtures/valid-patch.json');
  const execute = (args) => {
    const result = spawnSync(process.execPath, [runnerScript, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result;
  };
  const executeGit = (args, cwd = temporary) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  execute(['init', '--state', temporary, '--runner-id', 'runner-integration']);
  const runnerPrivate = JSON.parse(readFileSync(join(temporary, 'identity.json'), 'utf8'));
  const desktopPublicPath = join(temporary, 'desktop-public.json');
  writeFileSync(desktopPublicPath, JSON.stringify(publicIdentity(desktop)));
  execute(['trust-desktop', '--state', temporary, '--desktop-public', desktopPublicPath]);
  const request = sealEnvelope({
    schema: 'grok-crew.runner-request/v1',
    control_job: { id: 'job-integration', base_revision: 1 },
    timeline: { schema: 'grok-crew.timeline/v2', assets: [], tracks: [] },
    transcript: { words: [] }, thumbnails: [],
  }, desktop, publicIdentity(runnerPrivate));
  const requestPath = join(temporary, 'request.json');
  const outputPath = join(temporary, 'response');
  writeFileSync(requestPath, JSON.stringify(request));
  execute(['run-file', '--state', temporary, '--request', requestPath, '--output', outputPath, '--fixture-output', fixture]);
  const resultEnvelope = JSON.parse(readFileSync(join(outputPath, 'result.json'), 'utf8'));
  const resultPayload = openEnvelope(resultEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(resultPayload.timeline_patch.schema, 'grok-crew.timeline-patch/v1');
  assert.equal(resultPayload.timeline_patch.operations[0].changes.look, 'punchy');

  const inputOutput = join(temporary, 'needs-input-response');
  execute(['run-file', '--state', temporary, '--request', requestPath, '--output', inputOutput, '--fixture-output', resolve('runner/fixtures/needs-input.json')]);
  const inputEnvelope = JSON.parse(readFileSync(join(inputOutput, 'result.json'), 'utf8'));
  const inputPayload = openEnvelope(inputEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(inputPayload.outcome, 'needs_input');
  assert.equal(inputPayload.needs_input.options.length, 2);
  assert.equal(inputPayload.needs_input.question_id, 'hook-tone');

  const origin = join(temporary, 'relay-origin.git');
  const desktopClone = join(temporary, 'desktop-clone');
  const runnerClone = join(temporary, 'runner-clone');
  executeGit(['init', '--bare', '--initial-branch=main', origin]);
  executeGit(['clone', origin, desktopClone]);
  executeGit(['config', 'user.name', 'Relay test'], desktopClone);
  executeGit(['config', 'user.email', 'relay@example.invalid'], desktopClone);
  writeFileSync(join(desktopClone, 'README.md'), 'private encrypted relay fixture\n');
  executeGit(['add', 'README.md'], desktopClone);
  executeGit(['commit', '-m', 'initialize relay'], desktopClone);
  executeGit(['push', '-u', 'origin', 'main'], desktopClone);
  executeGit(['switch', '-c', 'control'], desktopClone);
  mkdirSync(join(desktopClone, 'requests'), { recursive: true });
  writeFileSync(join(desktopClone, 'requests', 'job-integration.request.json'), JSON.stringify(request));
  executeGit(['add', 'requests/job-integration.request.json'], desktopClone);
  executeGit(['commit', '-m', 'queue encrypted request'], desktopClone);
  executeGit(['push', '-u', 'origin', 'control'], desktopClone);
  executeGit(['switch', 'main'], desktopClone);
  const gitRelay = new GitRelay({
    dialog: {}, userData: join(temporary, 'desktop-state'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
  });
  const authRelay = new GitRelay({
    dialog: {}, userData: join(temporary, 'desktop-auth-state'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => url.endsWith('/user') ? { login: 'preview-user', avatar_url: 'https://example.invalid/avatar' } : {},
    }),
  });
  const authStatus = await authRelay.loginWithToken(`github_pat_${'x'.repeat(32)}`);
  assert.equal(authStatus.login, 'preview-user');
  assert.equal(authRelay.githubStatus().authenticated, true);
  gitRelay.saveConfig({ schema: 'grok-crew.git-relay/v1', repo: desktopClone, remote: origin, control_branch: 'control' });
  gitRelay.pushRequest('job-git-service', request);
  executeGit(['fetch', 'origin', 'control'], desktopClone);
  const pushedRequest = JSON.parse(executeGit(['show', 'origin/control:requests/job-git-service.request.json'], desktopClone));
  assert.equal(pushedRequest.signature, request.signature);
  executeGit(['clone', origin, runnerClone]);
  execute(['run-repo', '--state', temporary, '--repo', runnerClone, '--fixture-output', fixture]);
  executeGit(['fetch', 'origin', 'runner/runner-integration'], runnerClone);
  const gitEnvelope = JSON.parse(executeGit(['show', 'origin/runner/runner-integration:results/job-integration/result.json'], runnerClone));
  const gitPayload = openEnvelope(gitEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(gitPayload.timeline_patch.operations[0].changes.look, 'punchy');
  const firstEventName = executeGit(['ls-tree', '-r', '--name-only', 'origin/runner/runner-integration', '--', 'results/job-integration'], runnerClone)
    .split(/\r?\n/).find((name) => /event-\d+\.json$/.test(name));
  assert.ok(firstEventName);
  const eventEnvelope = JSON.parse(executeGit(['show', `origin/runner/runner-integration:${firstEventName}`], runnerClone));
  const eventPayload = openEnvelope(eventEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(eventPayload.schema, 'grok-crew.runner-event/v1');
  assert.equal(eventPayload.stage, 'claimed');
  assert.ok(Number(executeGit(['rev-list', '--count', 'origin/runner/runner-integration'], runnerClone)) >= 4);

  const controlledRequest = (jobId, attempt) => sealEnvelope({
    schema: 'grok-crew.runner-request/v1',
    control_job: { id: jobId, base_revision: 1, attempt },
    timeline: { schema: 'grok-crew.timeline/v2', assets: [], tracks: [] },
    transcript: { words: [] }, thumbnails: [],
  }, desktop, publicIdentity(runnerPrivate));
  const controlledCommand = (jobId, command, sequence, attempt) => sealEnvelope({
    schema: 'grok-crew.runner-control/v1', control_job_id: jobId,
    runner_id: runnerPrivate.id, command, sequence, attempt,
    requested_at: new Date().toISOString(), origin: 'human',
  }, desktop, publicIdentity(runnerPrivate));

  gitRelay.pushRequest('job-pause-resume', controlledRequest('job-pause-resume', 1));
  gitRelay.pushControl('job-pause-resume', controlledCommand('job-pause-resume', 'pause', 1, 1), 'pause');
  execute(['run-repo', '--state', temporary, '--repo', runnerClone, '--fixture-output', fixture, '--fixture-delay-ms', '500']);
  executeGit(['fetch', 'origin', 'runner/runner-integration'], runnerClone);
  const pausedEnvelope = JSON.parse(executeGit(['show', 'origin/runner/runner-integration:results/job-pause-resume/result.json'], runnerClone));
  const paused = openEnvelope(pausedEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(paused.outcome, 'paused');
  assert.equal(paused.control_receipt.command, 'pause');
  assert.equal(paused.control_receipt.sequence, 1);

  gitRelay.pushControl('job-pause-resume', controlledCommand('job-pause-resume', 'resume', 2, 2), 'resume');
  gitRelay.pushRequest('job-pause-resume', controlledRequest('job-pause-resume', 2));
  execute(['run-repo', '--state', temporary, '--repo', runnerClone, '--fixture-output', fixture, '--fixture-delay-ms', '100']);
  executeGit(['fetch', 'origin', 'runner/runner-integration'], runnerClone);
  const resumedEnvelope = JSON.parse(executeGit(['show', 'origin/runner/runner-integration:results/job-pause-resume/result.json'], runnerClone));
  const resumed = openEnvelope(resumedEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(resumed.outcome, 'timeline_patch');
  assert.equal(resumed.attempt, 2);
  const resumedEventNames = executeGit(['ls-tree', '-r', '--name-only', 'origin/runner/runner-integration', '--', 'results/job-pause-resume'], runnerClone)
    .split(/\r?\n/).filter((name) => /event-\d+\.json$/.test(name));
  const resumedSequences = resumedEventNames.map((name) => Number(name.match(/event-(\d+)\.json$/)?.[1]));
  assert.equal(new Set(resumedSequences).size, resumedSequences.length);
  assert.ok(Math.max(...resumedSequences) >= 5);

  gitRelay.pushRequest('job-cancel', controlledRequest('job-cancel', 1));
  gitRelay.pushControl('job-cancel', controlledCommand('job-cancel', 'cancel', 1, 1), 'cancel');
  execute(['run-repo', '--state', temporary, '--repo', runnerClone, '--fixture-output', fixture, '--fixture-delay-ms', '500']);
  executeGit(['fetch', 'origin', 'runner/runner-integration'], runnerClone);
  const cancelledEnvelope = JSON.parse(executeGit(['show', 'origin/runner/runner-integration:results/job-cancel/result.json'], runnerClone));
  const cancelled = openEnvelope(cancelledEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(cancelled.control_receipt.command, 'cancel');
  assert.equal(cancelled.control_receipt.process_terminated, true);

  gitRelay.pushRequest('job-active-cancel', controlledRequest('job-active-cancel', 1));
  const activeRunner = spawn(process.execPath, [runnerScript, 'run-repo', '--state', temporary, '--repo', runnerClone], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GROK_RUNNER_COMMAND: process.execPath,
      GROK_RUNNER_PREFIX_ARGS: JSON.stringify([resolve('runner/fixtures/slow-grok.mjs')]),
    },
  });
  const activeStdout = [];
  const activeStderr = [];
  activeRunner.stdout.on('data', (chunk) => activeStdout.push(String(chunk)));
  activeRunner.stderr.on('data', (chunk) => activeStderr.push(String(chunk)));
  let claimedActive = false;
  for (let attempt = 0; attempt < 50 && !claimedActive; attempt += 1) {
    spawnSync('git', ['-C', runnerClone, 'fetch', 'origin', 'runner/runner-integration'], { encoding: 'utf8' });
    const tree = spawnSync('git', ['-C', runnerClone, 'ls-tree', '-r', '--name-only', 'origin/runner/runner-integration', '--', 'results/job-active-cancel'], { encoding: 'utf8' });
    claimedActive = tree.status === 0 && /event-\d+\.json/.test(tree.stdout);
    if (!claimedActive) await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  assert.equal(claimedActive, true, 'Runner did not publish the claimed event before active cancellation.');
  gitRelay.pushControl('job-active-cancel', controlledCommand('job-active-cancel', 'cancel', 1, 1), 'cancel');
  const activeExit = await Promise.race([
    new Promise((resolveExit) => activeRunner.once('exit', (code) => resolveExit(code))),
    new Promise((_, rejectWait) => setTimeout(() => rejectWait(new Error('Active Runner cancellation timed out.')), 12_000)),
  ]);
  assert.equal(activeExit, 0, activeStderr.join('') || activeStdout.join(''));
  executeGit(['fetch', 'origin', 'runner/runner-integration'], runnerClone);
  const activeCancelledEnvelope = JSON.parse(executeGit(['show', 'origin/runner/runner-integration:results/job-active-cancel/result.json'], runnerClone));
  const activeCancelled = openEnvelope(activeCancelledEnvelope, desktop, publicIdentity(runnerPrivate));
  assert.equal(activeCancelled.outcome, 'cancelled');
  assert.equal(activeCancelled.control_receipt.process_was_running, true);
  assert.equal(activeCancelled.control_receipt.process_terminated, true);

  const serviceState = join(temporary, 'relay-service-state');
  mkdirSync(join(serviceState, 'runner-public'), { recursive: true });
  writeFileSync(join(serviceState, 'relay-identity.bin'), Buffer.from(JSON.stringify(desktop)));
  writeFileSync(join(serviceState, 'runner-public', `${runnerPrivate.id}.json`), JSON.stringify(publicIdentity(runnerPrivate)));
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => Buffer.from(value).toString('utf8'),
  };
  let serviceJob = {
    id: 'service-conflict', project_id: 'project-service', base_revision: 1,
    attempt: 1, status: 'proposal_ready', execution_policy: 'review_before_render',
    publish_policy_json: { schema: 'grok-crew.publish-policy/v1', instagram: 'ask', tiktok: 'ask', youtube: 'ask' },
  };
  let currentRevision = 2;
  let rejectPatch = true;
  const transitions = [];
  const fakeRequest = async (path, value = {}) => {
    if (path === '/api/v2/control-jobs') return { control_jobs: [serviceJob] };
    if (path === '/api/v2/projects/project-service/timeline') return { timeline: { revision: currentRevision } };
    if (path === '/api/v2/projects/project-service/timeline/patch') {
      if (rejectPatch) throw new Error(`stale_timeline_revision: expected ${currentRevision}, received 1.`);
      currentRevision += 1;
      return { timeline: { revision: currentRevision } };
    }
    if (path === '/api/projects/project-service/render') return { job: { id: 'render-service', status: 'queued' } };
    if (path === '/api/jobs/render-service/run') return { job: { id: 'render-service', status: 'succeeded' } };
    if (path === `/api/v2/control-jobs/${serviceJob.id}` && value.method === 'PATCH') {
      const body = JSON.parse(value.body);
      transitions.push(body);
      serviceJob = { ...serviceJob, ...body };
      return { control_job: serviceJob };
    }
    throw new Error(`Unexpected fake request: ${path}`);
  };
  const relayService = new RelayService({ request: fakeRequest, safeStorage: secureStorage, dialog: {}, userData: serviceState, documents: temporary });
  const conflictResult = sealEnvelope({
    schema: 'grok-crew.runner-result/v1', control_job_id: serviceJob.id,
    runner_id: runnerPrivate.id, base_revision: 1, attempt: 1, outcome: 'timeline_patch',
    timeline_patch: { schema: 'grok-crew.timeline-patch/v1', base_revision: 1, origin: 'remote_bot', operations: [{ op: 'set_settings', changes: { look: 'punchy' } }] },
    completed_at: new Date().toISOString(),
  }, runnerPrivate, publicIdentity(desktop));
  const storedConflict = await relayService.applyEnvelope(conflictResult, 'service conflict fixture');
  assert.equal(storedConflict.conflict.current_revision, 2);
  assert.equal(serviceJob.status, 'conflict');
  assert.equal(serviceJob.conflict.current_revision, 2);

  serviceJob = {
    id: 'service-render', project_id: 'project-service', base_revision: 1,
    attempt: 1, status: 'proposal_ready', execution_policy: 'auto_edit_render',
    publish_policy_json: { schema: 'grok-crew.publish-policy/v1', instagram: 'ask', tiktok: 'export_only', youtube: 'export_only' },
  };
  currentRevision = 1;
  rejectPatch = false;
  transitions.length = 0;
  const renderResult = sealEnvelope({
    schema: 'grok-crew.runner-result/v1', control_job_id: serviceJob.id,
    runner_id: runnerPrivate.id, base_revision: 1, attempt: 1, outcome: 'timeline_patch',
    timeline_patch: { schema: 'grok-crew.timeline-patch/v1', base_revision: 1, origin: 'remote_bot', operations: [{ op: 'set_settings', changes: { look: 'natural' } }] },
    completed_at: new Date().toISOString(),
  }, runnerPrivate, publicIdentity(desktop));
  const rendered = await relayService.applyEnvelope(renderResult, 'service render fixture');
  assert.equal(rendered.status, 'publish_waiting');
  assert.deepEqual(transitions.map((item) => item.status), ['proposal_ready', 'applied', 'rendering', 'rendered', 'publish_waiting']);
} finally {
  // Git can release pack/index handles a moment after the child process exits on Windows.
  // Retry cleanup so a successful relay test is not reported as a product failure.
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

process.stdout.write('relay crypto, tamper rejection, structured input, signed controls, resume sequencing, and Git branches passed\n');
