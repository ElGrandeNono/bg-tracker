import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CardDb, isBattlegroundsRelevant, toCardInfo, type CardInfo } from './cardDb.js';

/**
 * Chargement des données de cartes, versionnées par build du jeu.
 *
 * 1. cache local `<cacheDir>/<build>/<locale>.json` (sous-ensemble BG, quelques centaines de Ko) ;
 * 2. sinon HearthstoneJSON `/v1/<build>/<locale>/cards.json` (endpoint par build vérifié le
 *    18/10/2026 pour 251952 et 254477), puis `/v1/latest/…` si le build n'y est pas encore ;
 * 3. hors ligne : le cache du build le plus récent disponible, signalé comme périmé.
 *
 * C'est le SEUL accès réseau du noyau, nécessaire au fonctionnement (pas de télémétrie) ;
 * aucune donnée de l'utilisateur n'est envoyée.
 */

export type Locale = 'frFR' | 'enUS';

export interface LoadOptions {
  readonly build: string;
  readonly locale: Locale;
  readonly cacheDir: string;
  /** Injection pour les tests ; `globalThis.fetch` par défaut. */
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
}

export interface LoadResult {
  readonly db: CardDb;
  readonly source: 'cache' | 'network' | 'network-latest' | 'stale-cache';
  /** Build des données réellement chargées (différent de `build` si `stale-cache`). */
  readonly dataBuild: string;
  /** Vrai si les données ne correspondent pas exactement au build du jeu. */
  readonly stale: boolean;
}

const DEFAULT_BASE = 'https://api.hearthstonejson.com/v1';

const cachePath = (dir: string, build: string, locale: Locale): string =>
  join(dir, build, `${locale}.json`);

async function readCache(dir: string, build: string, locale: Locale): Promise<CardDb | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(cachePath(dir, build, locale), 'utf8'));
    const db = CardDb.fromRaw(raw);
    return db.size > 0 ? db : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(
  dir: string,
  build: string,
  locale: Locale,
  cards: CardInfo[],
): Promise<void> {
  const file = cachePath(dir, build, locale);
  await mkdir(join(dir, build), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(cards));
  await rename(tmp, file); // écriture atomique : jamais de cache à moitié écrit
}

async function download(url: string, doFetch: typeof fetch): Promise<CardInfo[] | undefined> {
  const res = await doFetch(url);
  if (!res.ok) return undefined;
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) throw new Error(`réponse inattendue de ${url}`);
  const cards: CardInfo[] = [];
  for (const r of raw as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const obj = r as Record<string, unknown>;
    if (!isBattlegroundsRelevant(obj)) continue;
    const c = toCardInfo(obj);
    if (c !== undefined) cards.push(c);
  }
  return cards;
}

/** Builds présents en cache pour une locale, du plus récent au plus ancien. */
async function cachedBuilds(dir: string, locale: Locale): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const builds: string[] = [];
  for (const n of names.filter((x) => /^\d+$/.test(x))) {
    try {
      await readFile(cachePath(dir, n, locale));
      builds.push(n);
    } catch {
      // pas de fichier pour cette locale
    }
  }
  return builds.sort((a, b) => Number(b) - Number(a));
}

export async function loadCardDb(options: LoadOptions): Promise<LoadResult> {
  const { build, locale, cacheDir } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl ?? DEFAULT_BASE;

  const cached = await readCache(cacheDir, build, locale);
  if (cached !== undefined) return { db: cached, source: 'cache', dataBuild: build, stale: false };

  try {
    const exact = await download(`${base}/${build}/${locale}/cards.json`, doFetch);
    if (exact !== undefined && exact.length > 0) {
      await writeCache(cacheDir, build, locale, exact);
      return { db: new CardDb(exact), source: 'network', dataBuild: build, stale: false };
    }
    const latest = await download(`${base}/latest/${locale}/cards.json`, doFetch);
    if (latest !== undefined && latest.length > 0) {
      // Pas mis en cache sous `build` : le prochain lancement retentera le build exact.
      return { db: new CardDb(latest), source: 'network-latest', dataBuild: 'latest', stale: true };
    }
  } catch {
    // hors ligne ou réponse invalide : on tente le cache le plus récent
  }

  for (const b of await cachedBuilds(cacheDir, locale)) {
    const db = await readCache(cacheDir, b, locale);
    if (db !== undefined) return { db, source: 'stale-cache', dataBuild: b, stale: true };
  }
  throw new Error(
    `Données de cartes indisponibles (build ${build}, ${locale}) : pas de réseau et pas de cache.`,
  );
}
