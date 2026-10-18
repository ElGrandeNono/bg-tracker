import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCardDb } from './loader.js';

// Données synthétiques reprenant la forme réelle de HearthstoneJSON (champs vérifiés le 18/10).
const SAMPLE = [
  {
    id: 'TB_BaconShop_HERO_55',
    dbfId: 60372,
    name: 'Fongimancien Flurgl',
    type: 'HERO',
    set: 'BATTLEGROUNDS',
    battlegroundsHero: true,
    heroPowerDbfId: 60448,
  },
  {
    id: 'BG20_HERO_202_SKIN_A',
    dbfId: 82094,
    name: 'Nguyen et Ban Lu',
    type: 'HERO',
    set: 'BATTLEGROUNDS',
    battlegroundsSkinParentId: 71908,
  },
  { id: 'BG20_HERO_202', dbfId: 71908, name: 'Nguyen', type: 'HERO', set: 'BATTLEGROUNDS' },
  {
    id: 'BG27_556_G',
    dbfId: 108930,
    name: 'Fourrageur boueux',
    type: 'MINION',
    set: 'BATTLEGROUNDS',
    techLevel: 3,
    races: ['MURLOC'],
    battlegroundsNormalDbfId: 108922,
  },
  {
    id: 'BG27_556',
    dbfId: 108922,
    name: 'Fourrageur boueux',
    type: 'MINION',
    set: 'BATTLEGROUNDS',
    techLevel: 3,
    races: ['MURLOC'],
    isBattlegroundsPoolMinion: true,
  },
  { id: 'CS2_029', dbfId: 315, name: 'Boule de feu', type: 'SPELL', set: 'LEGACY' },
];

let dir: string;
let calls: string[];

const fakeFetch =
  (status: Record<string, number>): typeof fetch =>
  (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const code = Object.entries(status).find(([k]) => url.includes(k))?.[1] ?? 404;
    return Promise.resolve(
      new Response(code === 200 ? JSON.stringify(SAMPLE) : '', { status: code }),
    );
  };

const offline: typeof fetch = () => Promise.reject(new Error('hors ligne'));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bgt-data-'));
  calls = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadCardDb', () => {
  it('télécharge le build exact, garde le sous-ensemble BG et le met en cache', async () => {
    const r = await loadCardDb({
      build: '254477',
      locale: 'frFR',
      cacheDir: dir,
      fetch: fakeFetch({ '/254477/': 200 }),
    });
    expect(r).toMatchObject({ source: 'network', stale: false, dataBuild: '254477' });
    expect(r.db.name('TB_BaconShop_HERO_55')).toBe('Fongimancien Flurgl');
    expect(r.db.byId('CS2_029')).toBeUndefined(); // carte hors BG écartée
    const again = await loadCardDb({
      build: '254477',
      locale: 'frFR',
      cacheDir: dir,
      fetch: offline,
    });
    expect(again.source).toBe('cache');
  });

  it('se rabat sur latest si le build n’est pas encore publié, signalé périmé', async () => {
    const r = await loadCardDb({
      build: '999999',
      locale: 'frFR',
      cacheDir: dir,
      fetch: fakeFetch({ '/latest/': 200 }),
    });
    expect(r).toMatchObject({ source: 'network-latest', stale: true });
  });

  it('hors ligne : utilise le cache le plus récent et le signale', async () => {
    await loadCardDb({
      build: '254477',
      locale: 'frFR',
      cacheDir: dir,
      fetch: fakeFetch({ '/254477/': 200 }),
    });
    const r = await loadCardDb({ build: '260000', locale: 'frFR', cacheDir: dir, fetch: offline });
    expect(r).toMatchObject({ source: 'stale-cache', dataBuild: '254477', stale: true });
  });

  it('échoue clairement sans réseau ni cache', async () => {
    await expect(
      loadCardDb({ build: '254477', locale: 'enUS', cacheDir: dir, fetch: offline }),
    ).rejects.toThrow(/indisponibles/);
  });
});

describe('CardDb', () => {
  it('ramène un skin au héros de base et un doré à sa version normale', async () => {
    const { db } = await loadCardDb({
      build: '1',
      locale: 'frFR',
      cacheDir: dir,
      fetch: fakeFetch({ '/1/': 200 }),
    });
    expect(db.baseHero('BG20_HERO_202_SKIN_A')?.id).toBe('BG20_HERO_202');
    expect(db.normalVersion('BG27_556_G')?.id).toBe('BG27_556');
    expect(db.name('INCONNU_123')).toBe('INCONNU_123');
  });
});
