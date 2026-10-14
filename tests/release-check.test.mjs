import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { newer } = createRequire(import.meta.url)('../electron/release-check.cjs');

test('version comparison used by the portable update check', () => {
  assert.equal(newer('0.1.1', '0.1.0'), true);
  assert.equal(newer('v0.2.0', '0.1.9'), true);
  assert.equal(newer('1.0.0', '0.99.99'), true);
  assert.equal(newer('0.10.0', '0.9.0'), true);
  assert.equal(newer('0.1.0', '0.1.0'), false);
  assert.equal(newer('0.1.0', '0.1.1'), false);
  assert.equal(newer('', '0.1.0'), false);
});
