import type { GameRecord } from './types.js';

/**
 * Statistiques sur l'historique local. Les parties abandonnées ou interrompues n'ont pas de place
 * finale : elles sont comptées à part et EXCLUES des moyennes et des taux (le 8 d'un abandon n'est
 * pas un classement).
 */

export interface Aggregate {
  /** Parties classées (terminées avec une place). */
  readonly games: number;
  readonly averagePlace: number | undefined;
  readonly top4Rate: number | undefined;
  readonly winRate: number | undefined;
}

export interface Stats extends Aggregate {
  /** Parties non classées : abandonnées, interrompues, tronquées sans place. */
  readonly unranked: number;
  readonly byHero: readonly (Aggregate & { readonly key: string })[];
  readonly byTribe: readonly (Aggregate & { readonly key: string })[];
  readonly byBuild: readonly (Aggregate & { readonly key: string })[];
  /** Places dans l'ordre chronologique (graphiques). */
  readonly series: readonly { readonly startedAt: string | undefined; readonly place: number }[];
  readonly distribution: readonly number[];
  readonly streaks: { readonly currentTop4: number; readonly bestTop4: number };
}

const ranked = (g: GameRecord): g is GameRecord & { finalPlace: number } =>
  g.outcome === 'finished' && g.finalPlace !== undefined;

export function aggregate(games: readonly GameRecord[]): Aggregate {
  const r = games.filter(ranked);
  if (r.length === 0)
    return { games: 0, averagePlace: undefined, top4Rate: undefined, winRate: undefined };
  return {
    games: r.length,
    averagePlace: r.reduce((s, g) => s + g.finalPlace, 0) / r.length,
    top4Rate: r.filter((g) => g.finalPlace <= 4).length / r.length,
    winRate: r.filter((g) => g.finalPlace === 1).length / r.length,
  };
}

function groupBy(
  games: readonly GameRecord[],
  keys: (g: GameRecord) => readonly string[],
): (Aggregate & { key: string })[] {
  const groups = new Map<string, GameRecord[]>();
  for (const g of games) {
    for (const k of keys(g)) groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  return [...groups]
    .map(([key, list]) => ({ key, ...aggregate(list) }))
    .filter((a) => a.games > 0)
    .sort((a, b) => b.games - a.games || (a.averagePlace ?? 9) - (b.averagePlace ?? 9));
}

export function computeStats(games: readonly GameRecord[]): Stats {
  const chrono = [...games].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  const r = chrono.filter(ranked);
  const distribution = Array.from(
    { length: 8 },
    (_, i) => r.filter((g) => g.finalPlace === i + 1).length,
  );
  let current = 0;
  let best = 0;
  for (const g of r) {
    current = g.finalPlace <= 4 ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return {
    ...aggregate(games),
    unranked: games.length - r.length,
    byHero: groupBy(games, (g) => [g.heroBaseCardId]),
    byTribe: groupBy(games, (g) => g.tribes),
    byBuild: groupBy(games, (g) => (g.build === undefined ? [] : [g.build])),
    series: r.map((g) => ({ startedAt: g.startedAt, place: g.finalPlace })),
    distribution,
    streaks: { currentTop4: current, bestTop4: best },
  };
}

/** Export CSV (séparateur `;`, en-têtes français), sans le replay. */
export function toCsv(games: readonly GameRecord[]): string {
  const header = [
    'date',
    'build',
    'mode',
    'heros',
    'heros_base',
    'issue',
    'place',
    'tribus',
    'tours',
    'duree_s',
    'mmr',
    'notes',
    'tags',
  ];
  const esc = (v: string): string => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = games.map((g) =>
    [
      g.startedAt ?? '',
      g.build ?? '',
      g.mode,
      g.heroCardId,
      g.heroBaseCardId,
      g.outcome,
      g.finalPlace?.toString() ?? '',
      g.tribes.join(' '),
      g.rounds.toString(),
      g.durationMs === undefined ? '' : Math.round(g.durationMs / 1000).toString(),
      g.mmr?.toString() ?? '',
      g.notes,
      g.tags.join(' '),
    ]
      .map(esc)
      .join(';'),
  );
  return [header.join(';'), ...rows].join('\r\n') + '\r\n';
}
