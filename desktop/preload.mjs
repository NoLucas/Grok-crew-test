import { contextBridge, ipcRenderer } from 'electron';

const runtimeArgument = process.argv.find((value) => value.startsWith('--grok-crew-runtime='));
const runtime = runtimeArgument ? JSON.parse(Buffer.from(runtimeArgument.split('=', 2)[1], 'base64url').toString('utf8')) : { apiBase: 'http://127.0.0.1:7214' };

contextBridge.exposeInMainWorld('grokCrew', Object.freeze({
  apiBase: runtime.apiBase,
  request: (path, request = {}) => ipcRenderer.invoke('studio:request', {
    path,
    method: request.method ?? 'GET',
    body: request.body ?? null,
  }),
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
