import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, it } from 'node:test';

register('./timeline/ts-resolver.helper.mjs', import.meta.url);

const { remoteDeskVisible, remoteNeedsAttention, isUnclaimedHold } = await import('./desktop-remote.ts');

const quiet = {
  runners: 0,
  githubAuthenticated: false,
  relayConnected: false,
  jobStatus: null,
  hasInputRequest: false,
  userOpened: false,
};

describe('remote desk visibility', () => {
  it('stays closed on a local-only first screen', () => {
    assert.equal(remoteDeskVisible(quiet), false);
    assert.equal(remoteNeedsAttention(quiet), false);
  });

  it('opens after the operator asks, or after pairing', () => {
    assert.equal(remoteDeskVisible({ ...quiet, userOpened: true }), true);
    assert.equal(remoteDeskVisible({ ...quiet, runners: 1 }), true);
    assert.equal(remoteDeskVisible({ ...quiet, githubAuthenticated: true }), true);
    assert.equal(remoteDeskVisible({ ...quiet, relayConnected: true }), true);
  });

  it('opens when a live job or input request needs the desk', () => {
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'needs_input' }), true);
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'conflict' }), true);
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'failed' }), true);
    assert.equal(remoteDeskVisible({ ...quiet, hasInputRequest: true }), true);
    assert.equal(remoteNeedsAttention({ jobStatus: 'needs_input', hasInputRequest: false }), true);
  });

  it('does not open for leftover queued jobs until a Runner is paired', () => {
    assert.equal(isUnclaimedHold('queued'), true);
    assert.equal(isUnclaimedHold('cancel_requested'), true);
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'queued' }), false);
    assert.equal(remoteNeedsAttention({ jobStatus: 'queued', hasInputRequest: false }), false);
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'queued', runners: 1 }), true);
    assert.equal(remoteNeedsAttention({ jobStatus: 'queued', hasInputRequest: false, runners: 1 }), true);
  });

  it('ignores finished jobs so a later local edit stays quiet', () => {
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'completed' }), false);
    assert.equal(remoteDeskVisible({ ...quiet, jobStatus: 'cancelled' }), false);
    assert.equal(remoteNeedsAttention({ jobStatus: 'completed', hasInputRequest: false }), false);
  });
});
