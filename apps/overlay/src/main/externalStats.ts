import { readFile, rename, writeFile } from 'node:fs/promises';
import type { CardDb } from '@bgt/data';
import type { ExternalStatsSummary, OptionStats } from '../shared/payload.js';

/**
 * Stats externes copiées À LA MAIN par l'utilisateur depuis HSReplay (pages Battlegrounds Heroes,
 * Duos Heroes, Trinkets) puis collées dans BG Tracker (Réglages › Stats externes). BG Tracker ne
 * contacte jamais le site. Ces données appartiennent à HSReplay : elles restent dans le dossier de
 * l'application de l'utilisateur, jamais dans le dépôt ni dans l'installeur.
 *
 * Format observé (copie du 21/10/2026, page en anglais, compte gratuit) :
 * - héros : « Nom, N Armor », vide, N, Nom, texte du pouvoir, « 78.3% » (taux de choix), puis la
 *   place moyenne (« 4.35 ») ou « — » / « Unlock with Tier7 » (réservée aux abonnés) ;
 * - bibelots : coût, Nom, texte, « 28.8% », « 3.55 », puis « 1st Place: 9.67% » … « 8th Place ».
 */

export type StatsPage = 'heroes-solo' | 'heroes-duos' | 'trinkets';

export interface ParsedRow {
  readonly name: string;
  readonly pickRate: number;
  readonly avgPlacement: number | undefined;
  readonly distribution: readonly number[] | undefined;
}

export interface ParsedPage {
  readonly page: StatsPage;
  readonly rows: readonly ParsedRow[];
}

const PCT = /^(\d+(?:\.\d+)?)%$/;
const AVG = /^([1-8]\.\d{1,2})$/;
const HERO_HEAD = /^(.+), \d+ Armor$/;
const PLACE = /^([1-8])(?:st|nd|rd|th) Place: (\d+(?:\.\d+)?)%$/;

export function detectPage(lines: readonly string[]): StatsPage | undefined {
  for (const l of lines.slice(0, 60)) {
    if (l === 'Battlegrounds Trinkets') return 'trinkets';
    if (l === 'Duos Heroes') return 'heroes-duos';
    if (l === 'Battlegrounds Heroes') return 'heroes-solo';
  }
  return undefined;
}

export function parseStatsCopy(text: string): ParsedPage | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const page = detectPage(lines);
  if (page === undefined) return undefined;
  const rows: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const pct = PCT.exec(lines[i] ?? '');
    if (pct === null) continue;
    let name: string | undefined;
    if (page === 'trinkets') {
      // coût, nom, texte, % : le coût est un entier seul.
      if (!/^\d+$/.test(lines[i - 3] ?? '')) continue;
      name = lines[i - 2];
    } else {
      // Remonte jusqu'à l'en-tête « Nom, N Armor » (au plus 6 lignes).
      for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
        const h = HERO_HEAD.exec(lines[k] ?? '');
        if (h !== null) {
          name = h[1];
          break;
        }
      }
    }
    if (name === undefined || name === '') continue;
    const avg = AVG.exec(lines[i + 1] ?? '');
    const dist: number[] = [];
    for (let k = i + 2; k < Math.min(lines.length, i + 20) && dist.length < 8; k++) {
      const m = PLACE.exec(lines[k] ?? '');
      if (m !== null) dist[Number(m[1]) - 1] = Number(m[2]) / 100;
    }
    rows.push({
      name,
      pickRate: Number(pct[1]) / 100,
      avgPlacement: avg === null ? undefined : Number(avg[1]),
      distribution: dist.length === 8 ? dist : undefined,
    });
  }
  return { page, rows };
}

/** Données enregistrées : par page, cardId → stats, avec la date de la copie. */
export interface StoredStats {
  readonly pages: Partial<
    Record<StatsPage, { readonly updatedAt: string; readonly cards: Record<string, OptionStats> }>
  >;
}

/** Suffixes de tribu (noms anglais du site) → tribu canonique (forme `BACON_SUBSET_`). */
const TRIBE_SUFFIXES: readonly (readonly [string, string])[] = [
  ['Aberration', 'ABERRATION'],
  ['Beast', 'BEAST'],
  ['Demon', 'DEMON'],
  ['Dragon', 'DRAGON'],
  ['Elemental', 'ELEMENTALS'],
  ['Mech', 'MECH'],
  ['Murloc', 'MURLOC'],
  ['Naga', 'NAGA'],
  ['Pirate', 'PIRATE'],
  ['Quilboar', 'QUILLBOAR'],
  ['Undead', 'UNDEAD'],
];

/**
 * Stats d'une carte ; pour un bibelot à variantes de tribu, moyenne des variantes des tribus du
 * lobby (toutes si le lobby est inconnu), avec leur nombre dans `variants`.
 */
export function statsFor(
  cards: Readonly<Record<string, OptionStats>>,
  cardId: string,
  lobbyTribes: readonly string[],
): OptionStats | undefined {
  const direct = cards[cardId];
  if (direct !== undefined) return direct;
  const all = Object.entries(cards).filter(([k]) => k.startsWith(`${cardId}#`));
  const inLobby = all.filter(([k]) => lobbyTribes.includes(k.slice(cardId.length + 1)));
  const used = (inLobby.length > 0 ? inLobby : all).map(([, s]) => s);
  if (used.length === 0) return undefined;
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgs = used.map((s) => s.avgPlacement).filter((x): x is number => x !== undefined);
  return {
    pickRate: mean(used.map((s) => s.pickRate)),
    avgPlacement: avgs.length === 0 ? undefined : mean(avgs),
    distribution: undefined,
    variants: used.length,
  };
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'").toLowerCase().trim();

/**
 * Associe les noms (anglais) aux cartes : héros de base (pas les skins) ou bibelots, d'après les
 * données HearthstoneJSON enUS. Renvoie aussi les noms non reconnus.
 */
export function matchRows(
  page: ParsedPage,
  db: CardDb,
): { cards: Record<string, OptionStats>; unmatched: string[] } {
  const byName = new Map<string, string>();
  for (const c of db.toJSON()) {
    const wanted =
      page.page === 'trinkets'
        ? c.type === 'BATTLEGROUND_TRINKET'
        : c.battlegroundsHero && c.battlegroundsSkinParentId === undefined;
    if (wanted && !byName.has(norm(c.name))) byName.set(norm(c.name), c.id);
  }
  const cards: Record<string, OptionStats> = {};
  const unmatched: string[] = [];
  for (const r of page.rows) {
    let key = byName.get(norm(r.name));
    // Bibelot dont la tribu est tirée pendant la partie (Colorful Compass) : HSReplay donne une
    // ligne par tribu, nom collé au nom de la tribu (« Colorful CompassDemon »). Clé `id#TRIBU`.
    if (key === undefined) {
      for (const [suffix, tribe] of TRIBE_SUFFIXES) {
        if (!r.name.endsWith(suffix)) continue;
        const id = byName.get(norm(r.name.slice(0, -suffix.length)));
        if (id !== undefined) key = `${id}#${tribe}`;
        break;
      }
    }
    if (key === undefined) {
      unmatched.push(r.name);
      continue;
    }
    cards[key] = {
      pickRate: r.pickRate,
      avgPlacement: r.avgPlacement,
      distribution: r.distribution,
      variants: undefined,
    };
  }
  return { cards, unmatched };
}

export async function loadStoredStats(file: string): Promise<StoredStats> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    const pages =
      typeof raw === 'object' && raw !== null ? (raw as { pages?: unknown }).pages : undefined;
    return typeof pages === 'object' && pages !== null ? (raw as StoredStats) : { pages: {} };
  } catch {
    return { pages: {} };
  }
}

export async function saveStoredStats(file: string, stats: StoredStats): Promise<void> {
  await writeFile(`${file}.tmp`, JSON.stringify(stats));
  await rename(`${file}.tmp`, file);
}

export function summarize(stats: StoredStats): ExternalStatsSummary {
  const one = (p: StatsPage): ExternalStatsSummary[StatsPage] => {
    const s = stats.pages[p];
    return s === undefined
      ? undefined
      : { updatedAt: s.updatedAt, count: Object.keys(s.cards).length };
  };
  return {
    'heroes-solo': one('heroes-solo'),
    'heroes-duos': one('heroes-duos'),
    trinkets: one('trinkets'),
  };
}
