import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVisibleView, Pipeline, readLogLines } from '@bgt/core';
import { GameRecorder } from './recorder.js';
import { computeStats, toCsv } from './stats.js';
import { HistoryStore } from './store.js';
import type { GameRecord } from './types.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

/** Rejoue un log comme l'overlay : enregistre à partir des vues affichées. */
async function record(name: string, sessionDate: Date): Promise<GameRecord[]> {
  const p = new Pipeline();
  const rec = new GameRecorder((id) => id, sessionDate);
  const out: GameRecord[] = [];
  p.subscribe(() => {
    const r = rec.observe(buildVisibleView(p.displayed.bg, p.displayed.state));
    if (r !== undefined) out.push(r);
  });
  for await (const line of readLogLines(fixture(name))) p.feedLine(line);
  p.end();
  const last = rec.observe(buildVisibleView(p.displayed.bg, p.displayed.state)) ?? rec.flush();
  if (last !== undefined) out.push(last);
  return out;
}

const games: Record<string, GameRecord> = {};

beforeAll(async () => {
  const cases: [string, string, Date][] = [
    ['complete', 'bg-solo-2026-10-18-complete.Power.log.gz', new Date(2026, 9, 18, 6, 10, 24)],
    ['tronque', 'bg-solo-2026-09-21-tronque.Power.log.gz', new Date(2026, 8, 21, 2, 20, 0)],
    ['abandon', 'bg-solo-2026-10-18-abandon.Power.log.gz', new Date(2026, 9, 18, 18, 50, 0)],
    [
      'aberrations',
      'bg-solo-2026-10-18-aberrations.Power.log.gz',
      new Date(2026, 9, 18, 19, 55, 0),
    ],
  ];
  for (const [k, file, date] of cases) {
    const rs = await record(file, date);
    expect(rs, k).toHaveLength(1);
    const r = rs[0];
    if (r !== undefined) games[k] = r;
  }
}, 120_000);

const g = (k: string): GameRecord => {
  const r = games[k];
  if (r === undefined) throw new Error(k);
  return r;
};

describe('GameRecorder sur les fixtures réelles', () => {
  it('partie complète : Flurgl, 3e, 5 tribus, 14 tours rejoués, ~26 minutes', () => {
    const r = g('complete');
    expect(r).toMatchObject({
      heroCardId: 'TB_BaconShop_HERO_55',
      outcome: 'finished',
      finalPlace: 3,
      build: '254477',
      mode: 'solo',
    });
    expect([...r.tribes].sort()).toEqual(['DEMON', 'DRAGON', 'ELEMENTALS', 'MECH', 'MURLOC']);
    expect(r.replay).toHaveLength(14);
    expect(r.replay[0]?.opponent?.board.length).toBeGreaterThan(0);
    expect(r.startedAt).toBe(new Date(2026, 9, 18, 6, 11, 54, 532).toISOString());
    expect(Math.round((r.durationMs ?? 0) / 60_000)).toBe(26);
  });

  it('abandons sans place finale, partie tronquée interrompue', () => {
    expect(g('abandon')).toMatchObject({
      outcome: 'abandoned',
      finalPlace: undefined,
      heroCardId: 'BG28_HERO_400',
    });
    expect(g('aberrations')).toMatchObject({
      outcome: 'abandoned',
      finalPlace: undefined,
      heroCardId: 'BG22_HERO_305',
    });
    expect(g('tronque')).toMatchObject({
      outcome: 'interrupted',
      finalPlace: undefined,
      truncated: true,
    });
  });
});

describe('HistoryStore (SQLite)', () => {
  it('insère, ignore les doublons, relit le replay, modifie et persiste', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bgt-history-'));
    const path = join(dir, 'history.sqlite');
    try {
      const store = new HistoryStore(path);
      expect(store.schemaVersion).toBe(1);
      for (const r of Object.values(games)) expect(store.insert(r)).toBe(true);
      expect(store.insert(g('complete'))).toBe(false); // même clé : doublon ignoré
      const list = store.list();
      expect(list).toHaveLength(4);
      expect(list[0]?.replay).toEqual([]); // la liste ne charge pas les replays
      const id = list.find((x) => x.finalPlace === 3)?.id ?? -1;
      expect(store.get(id)?.replay).toHaveLength(14);
      store.update(id, { mmr: 6543, notes: 'Murlocs', tags: ['test'] });
      store.close();

      const reopened = new HistoryStore(path);
      expect(reopened.get(id)).toMatchObject({ mmr: 6543, notes: 'Murlocs', tags: ['test'] });
      reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('statistiques', () => {
  it('exclut abandons et interruptions des moyennes, les compte à part', () => {
    const s = computeStats(Object.values(games));
    expect(s.games).toBe(1);
    expect(s.unranked).toBe(3);
    expect(s.averagePlace).toBe(3);
    expect(s.top4Rate).toBe(1);
    expect(s.winRate).toBe(0);
    expect(s.distribution).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
    expect(s.byHero[0]).toMatchObject({ key: 'TB_BaconShop_HERO_55', games: 1, averagePlace: 3 });
    expect(s.byTribe.map((t) => t.key).sort()).toEqual([
      'DEMON',
      'DRAGON',
      'ELEMENTALS',
      'MECH',
      'MURLOC',
    ]);
  });

  it('séries de top 4 et export CSV', () => {
    const base = g('complete');
    const mk = (place: number, day: number): GameRecord => ({
      ...base,
      key: `k${day}`,
      finalPlace: place,
      startedAt: new Date(2026, 9, day).toISOString(),
    });
    const s = computeStats([mk(2, 1), mk(4, 2), mk(6, 3), mk(1, 4), mk(3, 5)]);
    expect(s.streaks).toEqual({ currentTop4: 2, bestTop4: 2 });
    const csv = toCsv([{ ...base, notes: 'avec ; point-virgule' }]);
    expect(csv.split('\r\n')[0]).toBe(
      'date;build;mode;heros;heros_base;issue;place;tribus;tours;duree_s;mmr;notes;tags',
    );
    expect(csv).toContain('"avec ; point-virgule"');
  });
});
