'use strict';

// Electron's sandbox loader requires CommonJS for preload scripts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');

const runtimeArgument = process.argv.find((value) => value.startsWith('--grok-crew-runtime='));
const encodedRuntime = runtimeArgument ? runtimeArgument.split('=', 2)[1] : '';
const base64Runtime = encodedRuntime.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedRuntime.length / 4) * 4, '=');
if (!runtimeArgument && process.env.GROK_CREW_ALLOW_PRELOAD_FALLBACK !== '1') {
  throw new Error('Missing grok-crew runtime.');
}
const runtime = runtimeArgument
  ? JSON.parse(Buffer.from(base64Runtime, 'base64').toString('utf8'))
  : { apiBase: 'http://127.0.0.1:7214' };

contextBridge.exposeInMainWorld('grokCrew', Object.freeze({
  apiBase: runtime.apiBase,
  request: (path, request = {}) => ipcRenderer.invoke('studio:request', {
    path,
    method: request.method ?? 'GET',
    body: request.body ?? null,
  }),
  applyTimelinePatch: (projectId, timelinePatch) => ipcRenderer.invoke(
    'timeline:apply-patch', projectId, timelinePatch,
  ),
  selectMedia: () => ipcRenderer.invoke('desktop:select-media'),
  showOutput: (relativePath) => ipcRenderer.invoke('desktop:show-output', relativePath),
  appInfo: () => ipcRenderer.invoke('desktop:app-info'),
  pairRunner: () => ipcRenderer.invoke('relay:pair-runner'),
  exportDesktopPairing: () => ipcRenderer.invoke('relay:export-desktop-pairing'),
  exportRunnerRequest: (controlJobId) => ipcRenderer.invoke('relay:export-request', controlJobId),
  importRunnerResult: () => ipcRenderer.invoke('relay:import-result'),
  answerRunnerInput: (controlJobId, answer) => ipcRenderer.invoke('relay:answer-input', controlJobId, answer),
  connectGitRelay: () => ipcRenderer.invoke('relay:connect-git'),
  githubStatus: () => ipcRenderer.invoke('relay:github-status'),
  loginGitHubDevice: () => ipcRenderer.invoke('relay:github-login-device'),
  loginGitHubToken: (token) => ipcRenderer.invoke('relay:github-login-token', token),
  pushGitRequest: (controlJobId) => ipcRenderer.invoke('relay:push-git-request', controlJobId),
  pullGitResults: () => ipcRenderer.invoke('relay:pull-git-results'),
  controlRunnerJob: (controlJobId, command, reason = '') => ipcRenderer.invoke('relay:control-job', controlJobId, command, reason),
  resolveRunnerConflict: (controlJobId, action) => ipcRenderer.invoke('relay:resolve-conflict', controlJobId, action),
}));
