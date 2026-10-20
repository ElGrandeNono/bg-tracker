import { mkdtemp, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildVisibleView, Pipeline, readLogLines } from '@bgt/core';
import { DEFAULT_SETTINGS, type OverlayPayload } from '../shared/payload.js';
import { StreamServer, streamPayload } from './streamServer.js';

const FIXTURE = join(
  import.meta.dirname,
  '../../../../fixtures/bg-solo-2026-10-18-complete.Power.log.gz',
);

async function payloadFromFixture(): Promise<OverlayPayload> {
  const pipeline = new Pipeline();
  for await (const line of readLogLines(FIXTURE)) pipeline.feedLine(line);
  pipeline.end();
  const view = buildVisibleView(pipeline.displayed.bg, pipeline.displayed.state);
  return {
    view: { ...view, season: undefined },
    names: {},
    status: {
      source: 'live',
      configProblems: ['log.config'],
      hsWindow: 'fullscreen',
      cardData: 'ok',
      replayDone: false,
      stale: false,
    },
    settings: { ...DEFAULT_SETTINGS, locked: false },
    timerEndsAt: undefined,
    pool: { tiers: [], byTribe: {}, lobbyComplete: true, unverifiedRules: [], cards: {} },
    combatSim: undefined,
    tavernBuffs: [],
    manualTribes: undefined,
    deityCardId: undefined,
  };
}

// Vue réelle (fixture rejouée une seule fois pour tout le fichier).
let fixturePayload: OverlayPayload;
beforeAll(async () => {
  fixturePayload = await payloadFromFixture();
}, 120_000);

describe('mode streamer : expurgation', () => {
  it('masque les pseudos adverses, garde le joueur local et ne déverrouille jamais', () => {
    const p = fixturePayload;
    expect(p.view.players.some((pl) => !pl.isLocal && pl.name !== undefined)).toBe(true);
    const out = streamPayload(p, { ...DEFAULT_SETTINGS.streamer, hideOpponentNames: true });
    expect(out.view.players.filter((pl) => !pl.isLocal).every((pl) => pl.name === undefined)).toBe(
      true,
    );
    expect(out.settings.locked).toBe(true);
    expect(out.status.configProblems).toEqual([]);
    expect(out.status.hsWindow).toBe('ok');
    expect(out.pool).toBeDefined();
  });

  it('retire la simulation et le pool sur demande', () => {
    const p = fixturePayload;
    const out = streamPayload(p, {
      ...DEFAULT_SETTINGS.streamer,
      hideOpponentNames: false,
      hidePool: true,
      hideSimulation: true,
    });
    expect(out.pool).toBeUndefined();
    expect(out.combatSim).toBeUndefined();
    expect(out.view.players).toBe(p.view.players);
  });
});

describe('mode streamer : serveur local', () => {
  let server: StreamServer | undefined;
  afterEach(async () => {
    await server?.stop();
  });

  const get = (
    port: number,
    path: string,
    host = `127.0.0.1:${port}`,
  ): Promise<{ status: number; body: string; type: string }> =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
          if (path === '/events' && body.includes('\n\n')) res.destroy();
        });
        const done = (): void => {
          resolve({
            status: res.statusCode ?? 0,
            body,
            type: String(res.headers['content-type']),
          });
        };
        res.on('end', done);
        res.on('close', done);
      });
      req.on('error', reject);
      req.end();
    });

  async function started(): Promise<number> {
    const dir = await mkdtemp(join(tmpdir(), 'bgt-stream-'));
    await writeFile(
      join(dir, 'index.html'),
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'" />`,
    );
    server = new StreamServer(dir);
    for (let port = 47_300; port < 47_400; port++) {
      try {
        await server.start(port);
        return port;
      } catch {
        // port occupé : on essaie le suivant
      }
    }
    throw new Error('aucun port libre');
  }

  it('sert la page avec la seule connexion au flux local autorisée', async () => {
    const port = await started();
    const r = await get(port, '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain("connect-src 'self'");
    expect(r.body).not.toContain("connect-src 'none'");
  });

  it('refuse un autre Host (DNS rebinding) et toute sortie du dossier', async () => {
    const port = await started();
    expect((await get(port, '/', `evil.example:${port}`)).status).toBe(403);
    expect((await get(port, '/..%2f..%2fsecret.txt')).status).toBe(404);
  });

  it('diffuse la dernière vue en Server-Sent Events', async () => {
    const port = await started();
    const p = fixturePayload;
    server?.publish(p);
    const r = await get(port, '/events');
    expect(r.type).toBe('text/event-stream');
    const data = JSON.parse(r.body.replace(/^data: /, '').trim()) as OverlayPayload;
    expect(data.view.players).toHaveLength(p.view.players.length);
  });
});
