/**
 * Pool de serviteurs partagé : exemplaires restants par carte, niveau et tribu, et probabilité
 * de voir une carte à la prochaine actualisation. Module PUR : les règles viennent de la saison
 * (seasons/sNN), le catalogue des données de cartes (packages/data), les cartes retirées du pool
 * de la vue filtrée (visibility/view.ts) — donc uniquement de ce que le joueur a vu.
 *
 * Ce que l'on sait est une BORNE : le tracker ne voit ni les boutiques ni les mains des autres
 * joueurs, ni leurs plateaux après le dernier combat contre eux. Les restants affichés sont donc
 * des maxima, et les probabilités des estimations ; l'UI le dit.
 */

export interface RuleValue<T> {
  readonly value: T;
  /** Faux si les sources divergent ou ne sont pas officielles. */
  readonly verified: boolean;
}

export interface PoolRules {
  readonly copiesPerTier: Readonly<Record<number, RuleValue<number>>>;
  readonly shopSlotsPerTier: Readonly<Record<number, number>>;
  readonly tribesPerLobby: number;
  /** Tribus hors rotation : jamais tirées pour un lobby. */
  readonly excludedTribes: readonly string[];
  readonly copiesPerGolden: number;
  readonly eliminatedPlayersReturnMinions: RuleValue<boolean>;
}

export interface PoolCard {
  /** cardId de la version normale. */
  readonly id: string;
  readonly tier: number;
  /** Tribus canoniques (forme `BACON_SUBSET_`, voir bg/tribes.ts) ; vide = neutre. */
  readonly tribes: readonly string[];
  /** Serviteur « toutes tribus » (CARDRACE=ALL) : présent quel que soit le lobby. */
  readonly allTribes: boolean;
  /** Neutre rattaché à une tribu (`battlegroundsAssociatedRaces`) : présent seulement avec elle. */
  readonly associatedTribes: readonly string[];
  /** cardId de la version dorée, si connue. */
  readonly goldenId: string | undefined;
}

/** Exemplaires vus hors du pool, par carte (version normale ou dorée). */
export interface PoolSighting {
  readonly cardId: string;
  readonly golden: boolean;
  readonly source: 'local' | 'shop' | 'opponent';
  /** Plateau d'un joueur éliminé : rendu au pool si la règle de saison le dit. */
  readonly ownerEliminated?: boolean;
}

export type Membership = 'in' | 'possible' | 'out';

export interface PoolCardState {
  readonly card: PoolCard;
  readonly membership: Membership;
  readonly copies: number;
  readonly taken: number;
  readonly remaining: number;
}

export interface PoolTierSummary {
  readonly tier: number;
  readonly copiesPerCard: number;
  readonly verified: boolean;
  readonly cards: number;
  readonly total: number;
  readonly remaining: number;
}

export interface PoolState {
  readonly cards: readonly PoolCardState[];
  readonly tiers: readonly PoolTierSummary[];
  /** Restants par tribu (cartes `in` uniquement ; une carte à double type compte pour les deux). */
  readonly byTribe: Readonly<Record<string, number>>;
  /** Vrai quand toutes les tribus du lobby sont identifiées (sinon composition incertaine). */
  readonly lobbyComplete: boolean;
}

export function membership(
  card: PoolCard,
  lobbyTribes: readonly string[],
  rules: PoolRules,
  lobbyComplete: boolean,
): Membership {
  const active = (t: string): boolean => !rules.excludedTribes.includes(t);
  const tribes = card.tribes.filter(active);
  if (card.allTribes) return 'in';
  if (card.tribes.length === 0) {
    if (card.associatedTribes.length === 0) return 'in';
    if (card.associatedTribes.some((t) => lobbyTribes.includes(t))) return 'in';
    return lobbyComplete ? 'out' : 'possible';
  }
  if (tribes.length === 0) return 'out'; // uniquement des tribus hors rotation
  if (tribes.some((t) => lobbyTribes.includes(t))) return 'in';
  return lobbyComplete ? 'out' : 'possible';
}

export function computePool(
  catalog: readonly PoolCard[],
  rules: PoolRules,
  lobbyTribes: readonly string[],
  sightings: readonly PoolSighting[],
): PoolState {
  const lobbyComplete = lobbyTribes.length >= rules.tribesPerLobby;
  const byGolden = new Map<string, string>();
  for (const c of catalog) if (c.goldenId !== undefined) byGolden.set(c.goldenId, c.id);

  const taken = new Map<string, number>();
  for (const s of sightings) {
    if (s.ownerEliminated === true && rules.eliminatedPlayersReturnMinions.value) continue;
    const id = byGolden.get(s.cardId) ?? s.cardId;
    const n = s.golden ? rules.copiesPerGolden : 1;
    taken.set(id, (taken.get(id) ?? 0) + n);
  }

  const cards: PoolCardState[] = catalog.map((card) => {
    const copies = rules.copiesPerTier[card.tier]?.value ?? 0;
    const t = taken.get(card.id) ?? 0;
    return {
      card,
      membership: membership(card, lobbyTribes, rules, lobbyComplete),
      copies,
      taken: t,
      remaining: Math.max(0, copies - t),
    };
  });

  const tiers = Object.entries(rules.copiesPerTier)
    .map(([k, v]): PoolTierSummary => {
      const tier = Number(k);
      const inTier = cards.filter((c) => c.card.tier === tier && c.membership === 'in');
      return {
        tier,
        copiesPerCard: v.value,
        verified: v.verified,
        cards: inTier.length,
        total: inTier.length * v.value,
        remaining: inTier.reduce((n, c) => n + c.remaining, 0),
      };
    })
    .sort((a, b) => a.tier - b.tier);

  const byTribe: Record<string, number> = {};
  for (const c of cards) {
    if (c.membership !== 'in') continue;
    for (const t of c.card.tribes) byTribe[t] = (byTribe[t] ?? 0) + c.remaining;
  }

  return { cards, tiers, byTribe, lobbyComplete };
}

/**
 * Probabilité de voir au moins un exemplaire de `cardId` à la prochaine actualisation, au niveau
 * de taverne `tier` : tirage sans remise de `slots` cartes parmi les exemplaires restants des
 * niveaux ≤ `tier` (loi hypergéométrique). Estimation : le pool réel est plus petit.
 */
export function refreshProbability(
  pool: PoolState,
  cardId: string,
  tier: number,
  rules: PoolRules,
): number {
  const target = pool.cards.find((c) => c.card.id === cardId);
  if (target === undefined || target.membership === 'out' || target.card.tier > tier) return 0;
  const n = pool.cards
    .filter((c) => c.membership === 'in' && c.card.tier <= tier)
    .reduce((s, c) => s + c.remaining, 0);
  const k = target.remaining;
  const slots = Math.min(rules.shopSlotsPerTier[tier] ?? 0, n);
  if (k <= 0 || n <= 0 || slots <= 0) return 0;
  // P(aucun) = C(n-k, s) / C(n, s) = Π_{i=0}^{s-1} (n-k-i)/(n-i)
  let none = 1;
  for (let i = 0; i < slots; i++) none *= Math.max(0, n - k - i) / (n - i);
  return 1 - none;
}
