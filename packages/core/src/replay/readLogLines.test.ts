import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readLogLines } from './readLogLines.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));

async function header(path: string): Promise<{ lines: number; build?: string; names: string[] }> {
  let lines = 0;
  let build: string | undefined;
  const names: string[] = [];
  for await (const line of readLogLines(path)) {
    lines++;
    const b = /DebugPrintGame\(\) - BuildNumber=(\d+)/.exec(line);
    if (b) build = b[1];
    const n = /DebugPrintGame\(\) - PlayerID=\d+, PlayerName=(.+)$/.exec(line);
    if (n?.[1] !== undefined) names.push(n[1]);
  }
  return build === undefined ? { lines, names } : { lines, build, names };
}

describe('readLogLines sur les fixtures compressées', () => {
  it('lit le log tronqué du 21/09 (build 251952)', async () => {
    const h = await header(fixture('bg-solo-2026-09-21-tronque.Power.log.gz'));
    expect(h.build).toBe('251952');
    expect(h.lines).toBeGreaterThan(75_000);
    // Pseudo cyrillique anonymisé : vérifie le décodage UTF-8.
    expect(h.names).toContain('Игрок1');
  });

  it('lit la partie complète du 18/10 (build 254477)', async () => {
    const h = await header(fixture('bg-solo-2026-10-18-complete.Power.log.gz'));
    expect(h.build).toBe('254477');
    expect(h.lines).toBeGreaterThan(430_000);
  }, 60_000);
});
