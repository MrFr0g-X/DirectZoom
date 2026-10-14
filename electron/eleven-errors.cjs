// Plain-language explanations for ElevenLabs API errors (see explain()). No Electron imports,
// so it can be unit-tested.
const LINKS = {
  keys: { label: 'Manage API keys', url: 'https://elevenlabs.io/app/settings/api-keys' },
  plan: { label: 'Open ElevenLabs subscription', url: 'https://elevenlabs.io/app/subscription' },
  voices: { label: 'Open My Voices', url: 'https://elevenlabs.io/app/voice-lab' },
  status: { label: 'ElevenLabs status', url: 'https://status.elevenlabs.io/' },
};

/**
 * Turns an ElevenLabs failure into something a person can act on. The renderer receives it
 * through the error message (IPC only keeps the message), marked with "DZERR:" + JSON, and
 * shows it as a dialog. `code` is ElevenLabs' `detail.status`; `detail` is their own message.
 */
function explain(httpStatus, code, detail) {
  const c = String(code ?? '').toLowerCase();
  const d = String(detail ?? '').toLowerCase();
  const out = (title, message, extra = {}) => ({ service: 'ElevenLabs', title, message, code: code ?? (httpStatus ? `HTTP ${httpStatus}` : null), detail: detail ?? null, ...extra });

  if (c === 'no_key') return out('Add your ElevenLabs API key', 'This feature uses ElevenLabs. Add your API key in Settings to use it.', { settings: true, link: LINKS.keys });
  if (c === 'network') return out('Can’t reach ElevenLabs', 'Check your internet connection and try again. If you use a VPN or firewall, make sure it allows api.elevenlabs.io.');
  if (c === 'invalid_api_key' || (httpStatus === 401 && !c && !d.includes('quota')))
    return out('ElevenLabs didn’t accept your API key', 'The key may have been deleted, regenerated or copied incompletely. Create a new key on ElevenLabs and add it in Settings.', { settings: true, link: LINKS.keys });
  if (c === 'quota_exceeded' || d.includes('quota') || d.includes('credits'))
    return out('You’re out of ElevenLabs credits', 'Your ElevenLabs account doesn’t have enough credits left for this. Credits renew with your billing cycle, or you can upgrade your plan or buy more.', { link: LINKS.plan });
  if (c === 'missing_permissions' || d.includes('missing the permission'))
    return out('Your API key isn’t allowed to do this', 'This key was created with limited permissions. Edit the key on ElevenLabs to allow this feature (or create a key with full access), then try again.', { link: LINKS.keys });
  if (c === 'detected_unusual_activity' || d.includes('unusual activity'))
    return out('ElevenLabs paused free usage on this account', 'ElevenLabs disabled free-tier usage after detecting unusual activity (this can happen with VPNs or several free accounts). A paid plan restores access.', { link: LINKS.plan });
  if (c.includes('payment') || httpStatus === 402)
    return out('There’s a problem with your ElevenLabs payment', 'ElevenLabs couldn’t charge your plan. Update your payment details on ElevenLabs and try again.', { link: LINKS.plan });
  if (c === 'voice_not_found' || (c.includes('voice') && httpStatus === 404))
    return out('This voice isn’t available', 'The selected voice no longer exists in your ElevenLabs account. Choose another voice and try again.', { link: LINKS.voices });
  if (c.includes('voice') || d.includes('voice'))
    return out('This voice can’t be used right now', 'ElevenLabs won’t use this voice with your account. It may need a higher plan or have been removed by its owner. Choose another voice.', { link: LINKS.voices });
  if (c === 'max_character_limit_exceeded' || d.includes('character limit'))
    return out('The text is too long', 'This script is longer than ElevenLabs allows in one request. Split it into shorter voiceover clips.');
  if (c.includes('model'))
    return out('This ElevenLabs model isn’t available', 'Your plan or region doesn’t have access to the model this feature uses. Try again later or check your ElevenLabs plan.', { link: LINKS.plan });
  if (httpStatus === 413 || c.includes('too_large') || c.includes('too_long') || d.includes('too large') || d.includes('too long'))
    return out('This recording is too long for ElevenLabs', 'The audio is larger than ElevenLabs accepts in one request. Trim the recording or process a shorter part.');
  if (c === 'too_many_concurrent_requests')
    return out('Too many ElevenLabs requests at once', 'Your plan allows only a few requests at the same time. Wait for other ElevenLabs jobs (in DirectZoom or elsewhere) to finish, then try again.');
  if (c === 'system_busy' || httpStatus === 429 || (httpStatus ?? 0) >= 500)
    return out('ElevenLabs is busy', 'ElevenLabs is under heavy load or having problems right now. Please try again in a few minutes.', { link: LINKS.status });
  if (httpStatus === 403)
    return out('ElevenLabs refused this request', 'Your account or plan doesn’t allow this feature.', { link: LINKS.plan });
  return out('ElevenLabs couldn’t complete this', 'Something went wrong on ElevenLabs’ side. Please try again.');
}

module.exports = { explain, LINKS };
