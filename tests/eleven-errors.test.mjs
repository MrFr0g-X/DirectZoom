import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { explain } = createRequire(import.meta.url)('../electron/eleven-errors.cjs');

test('ElevenLabs error codes map to actionable explanations', () => {
  const cases = [
    [401, 'invalid_api_key', 'Invalid API key', /API key/, { settings: true }],
    [401, 'quota_exceeded', 'This request exceeds your quota of 10000.', /out of ElevenLabs credits/],
    [401, 'missing_permissions', 'The API key you used is missing the permission speech_to_text to execute this operation.', /isn’t allowed/],
    [401, 'detected_unusual_activity', 'Unusual activity detected. Free Tier usage disabled.', /paused free usage/],
    [400, 'voice_not_found', 'A voice with voice_id x does not exist.', /voice isn’t available/],
    [400, 'max_character_limit_exceeded', 'This request’s text has 12000 characters', /too long/],
    [429, 'too_many_concurrent_requests', '', /at once/],
    [429, 'system_busy', '', /busy/],
    [503, null, 'Service Unavailable', /busy/],
    [402, 'payment_issue', '', /payment/],
    [null, 'network', null, /Can’t reach/],
    [null, 'no_key', null, /Add your ElevenLabs API key/, { settings: true }],
    [418, 'something_new', 'Odd', /couldn’t complete/],
  ];
  for (const [status, code, detail, title, extra] of cases) {
    const info = explain(status, code, detail);
    assert.match(info.title, title, `${code} → ${info.title}`);
    assert.ok(info.message.length > 20);
    assert.equal(info.service, 'ElevenLabs');
    if (extra?.settings) assert.equal(info.settings, true);
  }
});

test('quota errors offer the subscription page and keep the original message', () => {
  const info = explain(401, 'quota_exceeded', 'This request exceeds your quota of 10000. You have 12 credits remaining.');
  assert.equal(info.link.url, 'https://elevenlabs.io/app/subscription');
  assert.match(info.detail, /12 credits remaining/);
  assert.equal(info.code, 'quota_exceeded');
});
