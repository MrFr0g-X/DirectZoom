import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Content Security Policy for the packaged app (the dev server needs inline scripts for hot reload).
// The interface only loads its own files, project media (dz-media:), generated blobs, and
// ElevenLabs voice previews (https audio).
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: dz-media:",
  "media-src 'self' data: blob: dz-media: https:",
  "connect-src 'self' data: blob: dz-media:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'directzoom-csp',
  apply: 'build',
  transformIndexHtml: html => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`),
});

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
  server: { port: 5173, strictPort: true },
});
