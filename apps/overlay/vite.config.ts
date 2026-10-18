import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * CSP stricte injectée dans le HTML de PRODUCTION uniquement (le serveur de dev de Vite a besoin
 * de scripts en ligne pour le rechargement à chaud). Aucun script distant, aucune connexion :
 * le renderer ne parle qu'au processus principal via le preload.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'bgt-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    copyPublicDir: false, // demo.json reste hors de l'application
  },
  server: { port: 5199, strictPort: true },
});
