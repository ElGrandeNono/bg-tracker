import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { OverlayPayload, StreamerSettings } from '../shared/payload.js';

/**
 * Mode streamer : petit serveur HTTP local pour une « source navigateur » OBS.
 *
 * - Désactivé par défaut ; écoute uniquement sur 127.0.0.1 (jamais sur le réseau local).
 * - Sert le renderer compilé (lecture seule) et la vue en Server-Sent Events (`/events`).
 * - La vue envoyée est la vue FILTRÉE de l'overlay, expurgée selon les réglages streamer.
 * - En-tête Host vérifié (protection contre le DNS rebinding) ; GET uniquement.
 */

/** Ce que voit OBS : pseudos adverses, simulation et pool masqués selon les réglages. */
export function streamPayload(p: OverlayPayload, s: StreamerSettings): OverlayPayload {
  return {
    ...p,
    view: s.hideOpponentNames
      ? {
          ...p.view,
          players: p.view.players.map((pl) => (pl.isLocal ? pl : { ...pl, name: undefined })),
        }
      : p.view,
    combatSim: s.hideSimulation ? undefined : p.combatSim,
    pool: s.hidePool ? undefined : p.pool,
    // Aucun message sur la configuration du poste du streamer ; jamais le mode déplacement.
    status: { ...p.status, configProblems: [], hsWindow: 'ok' },
    // Pas d'alertes à l'écran des spectateurs (elles restent sur l'overlay du joueur).
    settings: {
      ...p.settings,
      locked: true,
      backdrop: false,
      alerts: {
        sound: false,
        turnStart: false,
        timerLow: false,
        triple: false,
        tribesFound: false,
      },
    },
  };
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export class StreamServer {
  private server: Server | undefined;
  private readonly clients = new Set<ServerResponse>();
  private last: string | undefined;
  private port = 0;

  constructor(private readonly rendererDir: string) {}

  get running(): boolean {
    return this.server !== undefined;
  }

  get listeningPort(): number {
    return this.port;
  }

  async start(port: number): Promise<void> {
    if (this.server !== undefined && this.port === port) return;
    await this.stop();
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.port = port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    for (const c of this.clients) c.end();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  publish(payload: OverlayPayload): void {
    if (this.server === undefined) return;
    this.last = JSON.stringify(payload);
    for (const c of this.clients) c.write(`data: ${this.last}\n\n`);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (path === '/events') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream' });
      if (this.last !== undefined) res.write(`data: ${this.last}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    const rel = normalize(path === '/' ? 'index.html' : decodeURIComponent(path.slice(1)));
    const file = join(this.rendererDir, rel);
    if (rel.startsWith('..') || !file.startsWith(this.rendererDir + sep)) {
      res.writeHead(404).end();
      return;
    }
    try {
      let body: Buffer | string = await readFile(file);
      if (rel === 'index.html') {
        // Même CSP que dans Electron, sauf la connexion au flux local (même origine).
        body = body.toString('utf8').replace("connect-src 'none'", "connect-src 'self'");
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }
}
