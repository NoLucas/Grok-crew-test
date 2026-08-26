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

/** Jobs a Runner is already working — the desk must stay open. */
const LIVE_JOB_STATUSES = new Set([
  'claimed',
  'analyzing',
  'planning',
  'needs_input',
  'proposal_ready',
  'applied',
  'rendering',
  'rendered',
  'publish_waiting',
  'publishing',
  'conflict',
  'failed',
  'paused',
  'pause_requested',
]);

/** Created locally, but no Runner has claimed them yet. */
const UNCLAIMED_HOLD_STATUSES = new Set(['queued', 'cancel_requested']);

export function isUnclaimedHold(status?: string | null): boolean {
  return Boolean(status && UNCLAIMED_HOLD_STATUSES.has(status));
}

export function jobNeedsRemoteDesk(status?: string | null, hasRunner = false): boolean {
  if (!status || QUIET_JOB_STATUSES.has(status)) return false;
  if (LIVE_JOB_STATUSES.has(status)) return true;
  if (UNCLAIMED_HOLD_STATUSES.has(status)) return hasRunner;
  return false;
}

export function remoteDeskVisible(input: RemoteDeskInput): boolean {
  if (input.userOpened) return true;
  if (input.runners > 0 || input.githubAuthenticated || input.relayConnected) return true;
  if (input.hasInputRequest) return true;
  if (jobNeedsRemoteDesk(input.jobStatus, input.runners > 0)) return true;
  return false;
}

export function remoteNeedsAttention(input: Pick<RemoteDeskInput, 'jobStatus' | 'hasInputRequest'> & { runners?: number }): boolean {
  if (input.hasInputRequest) return true;
  return jobNeedsRemoteDesk(input.jobStatus, (input.runners ?? 0) > 0);
}
