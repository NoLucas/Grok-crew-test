import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createIdentity, openEnvelope, publicIdentity, sealEnvelope } from '../runner/crypto.mjs';
import { GitRelay } from './git-relay.mjs';

export class RelayService {
  constructor({ request, safeStorage, dialog, userData, documents, shell, clipboard, fetchImpl }) {
    this.request = request;
    this.safeStorage = safeStorage;
    this.dialog = dialog;
    this.userData = userData;
    this.documents = documents;
    this.git = new GitRelay({ dialog, safeStorage, userData, shell, clipboard, fetchImpl });
  }

  identityPath() { return join(this.userData, 'relay-identity.bin'); }
  runnerDirectory() { return join(this.userData, 'runner-public'); }

  identity() {
    const path = this.identityPath();
    if (existsSync(path)) {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
      return JSON.parse(this.safeStorage.decryptString(readFileSync(path)));
    }
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Pairing requires Windows Credential Manager or macOS Keychain.');
    const value = createIdentity(`desktop-${randomUUID().slice(0, 8)}`);
    mkdirSync(this.userData, { recursive: true });
    writeFileSync(path, this.safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
    return value;
  }

  runner(id) {
    const path = join(this.runnerDirectory(), `${id}.json`);
    if (!existsSync(path)) throw new Error(`Runner ${id} is not paired on this desktop.`);
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  async pairRunner() {
    const selected = await this.dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Runner pairing', extensions: ['json'] }] });
    if (selected.canceled) return null;
    const runner = JSON.parse(readFileSync(selected.filePaths[0], 'utf8'));
    if (runner.schema !== 'grok-crew.runner-pairing/v1' || !runner.id || !runner.signing_public_key || !runner.encryption_public_key) throw new Error('Invalid Grok Crew runner pairing file.');
    mkdirSync(this.runnerDirectory(), { recursive: true });
    writeFileSync(join(this.runnerDirectory(), `${runner.id}.json`), `${JSON.stringify(runner, null, 2)}\n`, { mode: 0o600 });
    await this.request('/api/v2/runners/pair', {
      method: 'POST', body: JSON.stringify({ runner_id: runner.id, display_name: runner.display_name ?? runner.id, public_key: runner.signing_public_key, encryption_key: runner.encryption_public_key }),
    });
    this.identity();
    return { runner_id: runner.id, display_name: runner.display_name ?? runner.id };
  }

  async exportDesktopPairing() {
    const identity = this.identity();
    const destination = await this.dialog.showSaveDialog({ defaultPath: join(this.documents, 'grok-crew-desktop-public.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (destination.canceled || !destination.filePath) return null;
    const value = { schema: 'grok-crew.desktop-pairing/v1', ...publicIdentity(identity) };
    writeFileSync(destination.filePath, `${JSON.stringify(value, null, 2)}\n`);
    return { file: destination.filePath, desktop_id: identity.id };
  }

  async job(controlJobId) {
    const response = await this.request('/api/v2/control-jobs');
    const value = response.control_jobs.find((item) => item.id === controlJobId);
    if (!value) throw new Error('Control job not found.');
    return value;
  }

  async requestEnvelope(controlJobId) {
    const controlJob = await this.job(controlJobId);
    const [timelineResponse, runnersResponse, analysisResponse] = await Promise.all([
      this.request(`/api/v2/projects/${controlJob.project_id}/timeline`),
      this.request('/api/v2/runners'),
      this.request(`/api/v2/projects/${controlJob.project_id}/analysis`),
    ]);
    const runnerRecord = runnersResponse.runners.find((item) => item.runner_id === controlJob.runner_id)
      ?? runnersResponse.runners.find((item) => ['paired', 'connected'].includes(item.status))
      ?? runnersResponse.runners[0];
    if (!runnerRecord) throw new Error('Pair a Runner before exporting a request.');
    const runner = this.runner(runnerRecord.runner_id);
    if (controlJob.runner_id !== runner.id) {
      await this.request(`/api/v2/control-jobs/${controlJob.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: controlJob.status, runner_id: runner.id }),
      });
      controlJob.runner_id = runner.id;
    }
    const timeline = structuredClone(timelineResponse.timeline);
    timeline.assets = timeline.assets.map((asset) => {
      const sanitized = { ...asset };
      delete sanitized.path;
      return sanitized;
    });
    const analysis = analysisResponse.analysis;
    const thumbnails = (analysis?.thumbnails_json ?? []).map((item) => ({
      id: item.id, at: item.at, mime_type: 'image/jpeg', data: readFileSync(item.path).toString('base64'),
    }));
    const portableControlJob = {
      schema: 'grok-crew.control-job/v1', id: controlJob.id, project_id: controlJob.project_id,
      base_revision: Number(controlJob.base_revision), settings: controlJob.settings_json ?? {},
      execution_policy: controlJob.execution_policy, publish_policy: controlJob.publish_policy_json ?? {},
      status: controlJob.status, attempt: Number(controlJob.attempt ?? 1),
      control_sequence: Number(controlJob.control_sequence ?? 0), runner_id: runner.id,
    };
    const payload = {
      schema: 'grok-crew.runner-request/v1', control_job: portableControlJob, timeline,
      transcript: analysis?.transcript_json ?? { status: 'not_generated', words: [] }, thumbnails,
      privacy: { original_media_included: false, local_paths_included: false },
      created_at: new Date().toISOString(),
    };
    const envelope = sealEnvelope(payload, this.identity(), runner);
    return { envelope, runner_id: runner.id, control_job_id: controlJobId };
  }

  async exportRequest(controlJobId) {
    const built = await this.requestEnvelope(controlJobId);
    const destination = await this.dialog.showSaveDialog({ defaultPath: join(this.documents, `grok-crew-${controlJobId}.request.json`), filters: [{ name: 'Encrypted Grok request', extensions: ['json'] }] });
    if (destination.canceled || !destination.filePath) return null;
    writeFileSync(destination.filePath, `${JSON.stringify(built.envelope, null, 2)}\n`);
    return { file: destination.filePath, runner_id: built.runner_id, control_job_id: controlJobId };
  }

  connectGitRelay() { return this.git.connect(); }
  githubStatus() { return this.git.githubStatus(); }
  loginGitHubDevice() { return this.git.loginWithDeviceFlow(); }
  loginGitHubToken(token) { return this.git.loginWithToken(token); }

  async pushGitRequest(controlJobId) {
    const built = await this.requestEnvelope(controlJobId);
    return { ...this.git.pushRequest(controlJobId, built.envelope), runner_id: built.runner_id, control_job_id: controlJobId };
  }

  async pushControlForJob(controlJob, command, reason = '') {
    const runners = await this.request('/api/v2/runners');
    const runnerRecord = runners.runners.find((item) => item.runner_id === controlJob.runner_id)
      ?? runners.runners.find((item) => ['paired', 'connected'].includes(item.status))
      ?? runners.runners[0];
    if (!runnerRecord) throw new Error('Pair a Runner before controlling a job.');
    const runner = this.runner(runnerRecord.runner_id);
    const payload = {
      schema: 'grok-crew.runner-control/v1', control_job_id: controlJob.id,
      runner_id: runner.id, command, sequence: Number(controlJob.control_sequence ?? 0),
      attempt: Number(controlJob.attempt ?? 1), reason: String(reason ?? '').slice(0, 500),
      requested_at: new Date().toISOString(), origin: 'human',
    };
    const envelope = sealEnvelope(payload, this.identity(), runner);
    return { ...this.git.pushControl(controlJob.id, envelope, command), control_job: controlJob, runner_id: runner.id, command };
  }

  async controlJob(controlJobId, command, reason = '') {
    if (!this.git.configured()) throw new Error('Connect the private GitHub relay before sending remote controls.');
    const response = await this.request(`/api/v2/control-jobs/${controlJobId}/control`, {
      method: 'POST', body: JSON.stringify({ command, reason }),
    });
    const controlled = await this.pushControlForJob(response.control_job, command, reason);
    if (['resume', 'retry'].includes(command)) {
      controlled.request = await this.pushGitRequest(controlJobId);
    }
    return controlled;
  }

  async resolveConflict(controlJobId, action) {
    const response = await this.request(`/api/v2/control-jobs/${controlJobId}/resolve-conflict`, {
      method: 'POST', body: JSON.stringify({ action }),
    });
    if (action === 'retry_current') {
      if (!this.git.configured()) throw new Error('Connect the private GitHub relay before retrying the conflict.');
      const controlled = await this.pushControlForJob(response.control_job, 'retry', 'Retry against the current timeline revision.');
      controlled.request = await this.pushGitRequest(controlJobId);
      return controlled;
    }
    return { control_job: response.control_job, action };
  }

  async recordVerifiedEvent(jobId, runnerId, stage, status, detail, verifiedAt, verifiedSequence) {
    let sequence = Number(verifiedSequence ?? 0);
    if (sequence < 1) {
      const current = await this.request(`/api/v2/control-jobs/${jobId}/events`);
      sequence = Math.max(0, ...(current.events ?? []).filter((item) => item.runner_id === runnerId).map((item) => Number(item.sequence) || 0)) + 1;
    }
    return await this.request('/api/v2/runner-events', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'grok-crew.runner-event/v1', control_job_id: jobId, runner_id: runnerId,
        sequence, stage, status, detail, verified_at: verifiedAt ?? new Date().toISOString(),
      }),
    });
  }

  async answerInput(controlJobId, answer) {
    if (!answer || !String(answer.value ?? '').trim()) throw new Error('Select an answer before continuing.');
    await this.request(`/api/v2/control-jobs/${controlJobId}/answer`, {
      method: 'POST', body: JSON.stringify({ question_id: answer.question_id, value: answer.value }),
    });
    if (this.git.configured()) return await this.pushGitRequest(controlJobId);
    return await this.exportRequest(controlJobId);
  }

  async importResult() {
    const selected = await this.dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Encrypted Runner result', extensions: ['json'] }] });
    if (selected.canceled) return null;
    const envelope = JSON.parse(readFileSync(selected.filePaths[0], 'utf8'));
    return await this.applyEnvelope(envelope, basename(selected.filePaths[0]));
  }

  async applyEnvelope(envelope, file = 'git relay') {
    const runner = this.runner(envelope.sender_id);
    const result = openEnvelope(envelope, this.identity(), runner);
    if (result.schema !== 'grok-crew.runner-result/v1') throw new Error('Invalid Runner result.');
    const job = await this.job(result.control_job_id);
    const resultAttempt = Number(result.attempt ?? 1);
    if (resultAttempt < Number(job.attempt ?? 1)) {
      return { control_job_id: job.id, runner_id: runner.id, ignored: true, reason: 'stale_attempt', file };
    }
    if (['cancelled', 'paused'].includes(result.outcome)) {
      const status = result.outcome === 'paused' ? 'paused' : 'cancelled';
      await this.request(`/api/v2/control-jobs/${job.id}`, {
        method: 'PATCH', body: JSON.stringify({ status, runner_id: runner.id }),
      });
      return { control_job_id: job.id, runner_id: runner.id, outcome: status, receipt: result.control_receipt, file };
    }
    if (result.outcome === 'needs_input' && result.needs_input) {
      await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'needs_input', runner_id: runner.id }) });
      return { control_job_id: job.id, runner_id: runner.id, needs_input: result.needs_input, file };
    }
    if (!result.timeline_patch) throw new Error('Runner result does not contain a timeline patch.');
    await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'proposal_ready', runner_id: runner.id }) });
    let applied;
    try {
      applied = await this.request(`/api/v2/projects/${job.project_id}/timeline/patch`, { method: 'POST', body: JSON.stringify(result.timeline_patch) });
    } catch (error) {
      const current = await this.request(`/api/v2/projects/${job.project_id}/timeline`);
      const message = error instanceof Error ? error.message : String(error);
      const conflict = {
        schema: 'grok-crew.timeline-conflict/v1', reason: message,
        expected_revision: Number(result.timeline_patch.base_revision ?? result.base_revision ?? job.base_revision),
        current_revision: Number(current.timeline.revision), timeline_patch: result.timeline_patch,
        received_at: new Date().toISOString(),
      };
      await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'conflict', error: message, runner_id: runner.id, conflict }) });
      return { control_job_id: job.id, runner_id: runner.id, conflict, file };
    }
    await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'applied', result_revision: applied.timeline.revision, runner_id: runner.id }) });
    if (job.execution_policy === 'auto_edit_render') {
      const queued = await this.request(`/api/projects/${job.project_id}/render`, { method: 'POST', body: JSON.stringify({ approved: true, requested_by: 'desktop_relay' }) });
      await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rendering', result_revision: applied.timeline.revision, render_job_id: queued.job.id, runner_id: runner.id }) });
      const rendered = await this.request(`/api/jobs/${queued.job.id}/run`, { method: 'POST', body: JSON.stringify({ wait: true }) });
      if (!['succeeded', 'completed'].includes(rendered.job.status)) {
        const error = String(rendered.job.error_text ?? 'Local render failed.');
        await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error, render_job_id: queued.job.id, runner_id: runner.id }) });
        return { control_job_id: job.id, revision: applied.timeline.revision, runner_id: runner.id, render_job_id: queued.job.id, error, file };
      }
      await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rendered', result_revision: applied.timeline.revision, render_job_id: queued.job.id, runner_id: runner.id }) });
      const publishModes = Object.values(job.publish_policy_json ?? {});
      const finalStatus = publishModes.some((mode) => ['ask', 'auto'].includes(mode)) ? 'publish_waiting' : 'completed';
      await this.request(`/api/v2/control-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: finalStatus, result_revision: applied.timeline.revision, render_job_id: queued.job.id, runner_id: runner.id }) });
      return { control_job_id: job.id, revision: applied.timeline.revision, runner_id: runner.id, render_job_id: queued.job.id, status: finalStatus, file };
    }
    return { control_job_id: job.id, revision: applied.timeline.revision, runner_id: runner.id, status: 'applied', file };
  }

  async applyEventEnvelope(envelope, file = 'git relay event') {
    const runner = this.runner(envelope.sender_id);
    const event = openEnvelope(envelope, this.identity(), runner);
    if (event.schema !== 'grok-crew.runner-event/v1' || !event.control_job_id || !event.stage) throw new Error('Invalid signed Runner event.');
    await this.recordVerifiedEvent(event.control_job_id, runner.id, event.stage, event.status, event.detail ?? {}, event.verified_at, event.sequence);
    return { control_job_id: event.control_job_id, runner_id: runner.id, stage: event.stage, file };
  }

  async pullGitResults() {
    const runners = await this.request('/api/v2/runners');
    const pending = this.git.results((runners.runners ?? []).map((item) => item.runner_id));
    const applied = [];
    for (const item of pending) {
      const result = item.kind === 'event'
        ? await this.applyEventEnvelope(item.envelope, item.key)
        : await this.applyEnvelope(item.envelope, item.key);
      this.git.markImported(item.key);
      applied.push(result);
    }
    return { count: applied.length, results: applied };
  }
}
