import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requirementsStamp } from './local-runtime.mjs';

test('requirements stamp is stable for the same file bytes', () => {
  assert.equal(requirementsStamp(Buffer.from('moviepy==1\n')), requirementsStamp(Buffer.from('moviepy==1\n')));
  assert.notEqual(requirementsStamp(Buffer.from('moviepy==1\n')), requirementsStamp(Buffer.from('moviepy==2\n')));
});
