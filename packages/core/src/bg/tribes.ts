/**
 * Déduction progressive des tribus du lobby.
 *
 * Le log n'annonce pas les tribus au début de la partie (vérifié sur les deux fixtures) :
 * `BACON_SUBSET_<TRIBU>` n'apparaît que sur les serviteurs au fur et à mesure qu'ils sont vus.
 * On compte les cartes DISTINCTES vues par tribu ; les tribus réelles dépassent vite les autres,
 * qui n'arrivent que par des effets (partie du 18/10 : 23 à 40 cartes pour les 5 vraies tribus,
 * 3 à 5 pour les autres). Le résultat est toujours présenté avec un niveau de confiance.
 */

export const SUBSET_TAG_PREFIX = 'BACON_SUBSET_';

export interface TribeSightings {
  /** Tribu (suffixe du tag, ex. `MURLOC`, `ELEMENTALS`) → cardIds de base distincts vus. */
  readonly cards: Readonly<Record<string, readonly string[]>>;
}

export const emptyTribeSightings: TribeSightings = { cards: {} };

export interface TribeOptions {
  /** Nombre de tribus par lobby. 5 dans les parties observées ; à confirmer par saison. */
  readonly expectedTribes: number;
  /** Cartes distinctes à partir desquelles une tribu est considérée comme identifiée. */
  readonly minDistinctCards: number;
}

export const defaultTribeOptions: TribeOptions = { expectedTribes: 5, minDistinctCards: 8 };

/** Version dorée → carte de base (`BG27_556_G` → `BG27_556`), forme observée dans les logs. */
export function baseMinionCardId(cardId: string): string {
  return cardId.endsWith('_G') ? cardId.slice(0, -2) : cardId;
}

export function recordSighting(
  sightings: TribeSightings,
  tribes: readonly string[],
  cardId: string,
): TribeSightings {
  const base = baseMinionCardId(cardId);
  let cards = sightings.cards;
  for (const tribe of tribes) {
    const seen = cards[tribe] ?? [];
    if (seen.includes(base)) continue;
    cards = { ...cards, [tribe]: [...seen, base] };
  }
  return cards === sightings.cards ? sightings : { cards };
}

export interface TribeEstimate {
  readonly tribe: string;
  readonly distinctCards: number;
  readonly identified: boolean;
}

export interface LobbyTribes {
  /** Toutes les tribus vues, triées par nombre de cartes distinctes décroissant. */
  readonly tribes: readonly TribeEstimate[];
  readonly identified: readonly string[];
  readonly expected: number;
}

export function estimateLobbyTribes(
  sightings: TribeSightings,
  options: TribeOptions = defaultTribeOptions,
): LobbyTribes {
  const sorted = Object.entries(sightings.cards)
    .map(([tribe, cards]) => ({ tribe, distinctCards: cards.length }))
    .sort((a, b) => b.distinctCards - a.distinctCards || a.tribe.localeCompare(b.tribe));
  const tribes = sorted.map((t, i) => ({
    ...t,
    identified: i < options.expectedTribes && t.distinctCards >= options.minDistinctCards,
  }));
  return {
    tribes,
    identified: tribes.filter((t) => t.identified).map((t) => t.tribe),
    expected: options.expectedTribes,
  };
}
