// ElevenLabs integration (captions via Scribe speech-to-text, voiceover via text-to-speech).
// The API key is entered by the user and stored encrypted with Electron safeStorage in the
// user's profile; it is never bundled with the app.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { explain } = require('./eleven-errors.cjs');

const API = 'https://api.elevenlabs.io/v1';
const keyFile = () => path.join(app.getPath('userData'), 'elevenlabs.key');

async function getKey() {
  try {
    const data = await fsp.readFile(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : null;
  } catch {
    return null;
  }
}

async function setKey(key) {
  const trimmed = String(key ?? '').trim();
  if (!trimmed) { await fsp.rm(keyFile(), { force: true }); return { configured: false }; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system');
  await validate(trimmed);
  await fsp.writeFile(keyFile(), safeStorage.encryptString(trimmed));
  return { configured: true };
}

async function status() {
  return { configured: fs.existsSync(keyFile()) && !!(await getKey()) };
}

function elevenError(httpStatus, code, detail) {
  const info = explain(httpStatus, code, detail);
  const error = new Error(`DZERR:${JSON.stringify(info)}`);
  error.status = httpStatus;
  error.code = code;
  return error;
}

const retryable = (status, code) => status >= 500 || code === 'system_busy' || code === 'too_many_concurrent_requests';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(route, init = {}, key) {
  const apiKey = key ?? (await getKey());
  if (!apiKey) throw elevenError(null, 'no_key');
  // Busy / overloaded responses are retried twice (2 s, then 6 s) before giving up.
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(`${API}${route}`, { ...init, headers: { 'xi-api-key': apiKey, ...(init.headers ?? {}) } });
    } catch {
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
      throw elevenError(null, 'network');
    }
    if (response.ok) return response;
    let code = null, detail = null;
    try {
      const body = await response.json();
      const d = body?.detail;
      if (Array.isArray(d)) detail = d.map(x => x?.msg ?? JSON.stringify(x)).join('; ');
      else if (typeof d === 'string') detail = d;
      else { code = d?.status ?? d?.code ?? null; detail = d?.message ?? null; }
    } catch {}
    if (retryable(response.status, code) && attempt < 2) { await sleep(attempt ? 6000 : 2000); continue; }
    throw elevenError(response.status, code, detail ?? response.statusText);
  }
}

/** Cheap authenticated call used to check a key before saving it. */
async function validate(key) {
  try {
    await request('/user/subscription', {}, key);
  } catch (error) {
    // Keys restricted to some features may not read the subscription; they still work.
    if (error.code === 'missing_permissions' || error.status === 403) return;
    throw error;
  }
}

/** Plan and credit usage for Settings, or { available: false } when the key can't read it. */
async function account() {
  if (!(await getKey())) return { configured: false };
  try {
    const s = await (await request('/user/subscription')).json();
    return {
      configured: true, available: true, tier: s.tier ?? null, status: s.status ?? null,
      used: s.character_count ?? 0, limit: s.character_limit ?? 0,
      resetsAt: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : null,
    };
  } catch (error) {
    if (error.code === 'missing_permissions' || error.status === 403) return { configured: true, available: false };
    throw error;
  }
}

/** Speech-to-text with word timestamps. `file` is a compact audio file (mp3/ogg). */
async function transcribe(file, { language } = {}) {
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  if (language) form.append('language_code', language);
  form.append('file', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
  const response = await request('/speech-to-text', { method: 'POST', body: form });
  const body = await response.json();
  const words = (body.words ?? [])
    .filter(w => w.type === 'word' && String(w.text ?? '').trim())
    .map(w => ({ text: String(w.text).trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000), confidence: w.logprob !== undefined ? Math.exp(w.logprob) : 1 }));
  return { language: body.language_code ?? null, text: body.text ?? '', words };
}

async function voices() {
  const response = await request('/voices');
  const body = await response.json();
  return (body.voices ?? []).map(v => ({
    id: v.voice_id, name: v.name, category: v.category ?? '',
    description: [v.labels?.gender, v.labels?.accent, v.labels?.age, v.labels?.description ?? v.labels?.descriptive].filter(Boolean).join(' · '),
    previewUrl: v.preview_url ?? null,
  }));
}

/**
 * Text-to-speech with character alignment. Writes an MP3 to `output` and returns per-word
 * timings (ms from the start of the audio).
 */
async function speak({ text, voiceId, modelId = 'eleven_multilingual_v2', stability = 0.5, similarity = 0.75, style = 0, speed = 1 }, output) {
  const response = await request(`/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability, similarity_boost: similarity, style, speed, use_speaker_boost: true } }),
  });
  const body = await response.json();
  await fsp.writeFile(output, Buffer.from(body.audio_base64, 'base64'));
  const alignment = body.alignment ?? body.normalized_alignment;
  return { words: alignmentToWords(alignment) };
}

/** Groups character timings into words. */
function alignmentToWords(alignment) {
  if (!alignment?.characters?.length) return [];
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let current = null;
  characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (current) words.push(current); current = null; return; }
    if (!current) current = { text: '', startMs: Math.round(starts[i] * 1000), endMs: 0, confidence: 1 };
    current.text += ch;
    current.endMs = Math.round(ends[i] * 1000);
  });
  if (current) words.push(current);
  return words;
}

/** Voice Isolator: removes background noise from speech. Writes the result to `output`. */
async function isolate(file, output) {
  const form = new FormData();
  form.append('audio', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
  const response = await request('/audio-isolation', { method: 'POST', body: form });
  await fsp.writeFile(output, Buffer.from(await response.arrayBuffer()));
}

/** Speech-to-speech: re-voices `file` with `voiceId`, keeping the timing. */
async function revoice(file, voiceId, output) {
  const form = new FormData();
  form.append('model_id', 'eleven_multilingual_sts_v2');
  form.append('remove_background_noise', 'true');
  form.append('audio', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
  const response = await request(`/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, { method: 'POST', body: form });
  await fsp.writeFile(output, Buffer.from(await response.arrayBuffer()));
}

module.exports = { status, setKey, account, transcribe, voices, speak, alignmentToWords, isolate, revoice, explain };
