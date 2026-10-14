/**
 * Errors from the main process arrive as plain messages ("Error invoking remote method …").
 * Service errors that need the user's attention (ElevenLabs credits, key, voice …) are encoded
 * by the main process as "DZERR:" + JSON; those open a dialog (see ErrorDialog), everything else
 * stays an inline message.
 */
export type FriendlyError = {
  service: string;
  title: string;
  message: string;
  code?: string | null;
  detail?: string | null;
  settings?: boolean;
  link?: { label: string; url: string };
};

const raw = (error: unknown) => String((error as Error)?.message ?? error);

export function parseError(error: unknown): FriendlyError | null {
  const match = /DZERR:(\{.*\})\s*$/s.exec(raw(error));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/** The message to show inline, without Electron's IPC prefix. */
export function errorText(error: unknown) {
  const friendly = parseError(error);
  if (friendly) return friendly.title;
  return raw(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** Shows the error dialog for service errors and returns the short inline text either way. */
export function reportError(error: unknown) {
  const friendly = parseError(error);
  if (friendly) window.dispatchEvent(new CustomEvent<FriendlyError>('dz-error', { detail: friendly }));
  return errorText(error);
}

export const openSettings = () => window.dispatchEvent(new Event('dz-open-settings'));
