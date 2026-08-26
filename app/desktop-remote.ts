/** When the GitHub / Runner inspector should take first-screen space. */

export type RemoteDeskInput = {
  runners: number;
  githubAuthenticated: boolean;
  relayConnected: boolean;
  jobStatus?: string | null;
  hasInputRequest: boolean;
  userOpened: boolean;
};

const QUIET_JOB_STATUSES = new Set(['completed', 'cancelled']);

export function remoteDeskVisible(input: RemoteDeskInput): boolean {
  if (input.userOpened) return true;
  if (input.runners > 0 || input.githubAuthenticated || input.relayConnected) return true;
  if (input.hasInputRequest) return true;
  if (input.jobStatus && !QUIET_JOB_STATUSES.has(input.jobStatus)) return true;
  return false;
}

export function remoteNeedsAttention(input: Pick<RemoteDeskInput, 'jobStatus' | 'hasInputRequest'>): boolean {
  if (input.hasInputRequest) return true;
  return Boolean(input.jobStatus && !QUIET_JOB_STATUSES.has(input.jobStatus));
}
