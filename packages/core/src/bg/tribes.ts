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

/**
 * Le log nomme les tribus de deux façons, avec des orthographes différentes :
 * `BACON_SUBSET_<X>=1` (plusieurs par serviteur possible) et `CARDRACE=<X>` (une valeur).
 * Correspondances OBSERVÉES dans les fixtures (F2 et partie aux Aberrations du 18/10/2026) :
 * MECHANICAL ↔ MECH, ELEMENTAL ↔ ELEMENTALS, QUILBOAR (un L) ↔ QUILLBOAR (deux L) ;
 * MURLOC, DRAGON, DEMON, NAGA, PIRATE, UNDEAD, ABERRATION sont identiques des deux côtés.
 * La forme canonique est celle de `BACON_SUBSET_`. Une valeur inconnue est gardée telle quelle.
 */
const CARDRACE_TO_SUBSET: Readonly<Record<string, string>> = {
  MECHANICAL: 'MECH',
  ELEMENTAL: 'ELEMENTALS',
  QUILBOAR: 'QUILLBOAR',
};

/** `CARDRACE` sans tribu réelle (`ALL` = serviteur de toutes les tribues, `INVALID`). */
const NON_TRIBE_RACES = new Set(['ALL', 'INVALID', 'NONE', 'BLANK']);

export function canonicalTribe(name: string): string {
  return CARDRACE_TO_SUBSET[name] ?? name;
}

/** Tribus d'un serviteur, d'après ses tags `BACON_SUBSET_*` et `CARDRACE`, sans doublon. */
export function tribesOfTags(tags: Readonly<Record<string, number | string>>): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(tags)) {
    if (k.startsWith(SUBSET_TAG_PREFIX) && v === 1) {
      out.add(canonicalTribe(k.slice(SUBSET_TAG_PREFIX.length)));
    }
  }
  const race = tags.CARDRACE;
  if (typeof race === 'string' && !NON_TRIBE_RACES.has(race)) out.add(canonicalTribe(race));
  return [...out];
}

export interface TribeOptions {
  /** Nombre de tribus par lobby. 5 dans les parties observées ; à confirmer par saison. */
  readonly expectedTribes: number;
  /** Cartes distinctes à partir desquelles une tribu est considérée comme identifiée. */
  readonly minDistinctCards: number;
}

/**
 * Seuil mesuré le 21/10/2026 sur 10 parties complètes (fixtures `bg-solo-*`) : les tribus hors
 * lobby ne dépassent jamais 3 cartes distinctes, celles du lobby en ont 8 à 34 en fin de partie ;
 * aucune erreur pour un seuil de 3 à 8. 5 garde 2 cartes de marge et identifie les 5 tribus au
 * tour 7,3 en moyenne (8,8 avec l'ancien seuil de 8).
 */
export const defaultTribeOptions: TribeOptions = { expectedTribes: 5, minDistinctCards: 5 };

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
