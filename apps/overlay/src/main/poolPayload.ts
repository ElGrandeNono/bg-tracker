import {
  computePool,
  refreshProbability,
  type PoolCard,
  type PoolRules,
  type VisibleView,
} from '@bgt/core';
import type { CardDb } from '@bgt/data';
import type { CatalogCard, PoolPayload } from '../shared/payload.js';

/** Texte de carte HearthstoneJSON → texte brut (balises `<b>`/`<i>`, marqueur `[x]`). */
export function plainText(text: string): string {
  return text
    .replace(/\[x\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function catalogCards(
  db: CardDb,
  catalog: readonly PoolCard[],
  rules: PoolRules,
): CatalogCard[] {
  return catalog.map((c) => {
    const info = db.byId(c.id);
    return {
      id: c.id,
      name: info?.name ?? c.id,
      tier: c.tier,
      tribes: c.tribes,
      allTribes: c.allTribes,
      attack: info?.attack,
      health: info?.health,
      mechanics: info?.mechanics ?? [],
      text: plainText(info?.text ?? ''),
      copies: rules.copiesPerTier[c.tier]?.value ?? 0,
    };
  });
}

/** Pool estimé à partir de la vue FILTRÉE (cartes vues uniquement) et des règles de saison. */
export function poolPayload(
  view: VisibleView,
  catalog: readonly PoolCard[],
  rules: PoolRules,
): PoolPayload {
  const pool = computePool(catalog, rules, view.tribes.identified, view.poolSightings);
  const tier = view.local.techLevel ?? 1;
  const cards: PoolPayload['cards'] = Object.fromEntries(
    pool.cards.map((c) => [
      c.card.id,
      {
        remaining: c.remaining,
        membership: c.membership,
        probability: refreshProbability(pool, c.card.id, tier, rules),
      },
    ]),
  );
  const unverifiedRules = Object.entries(rules.copiesPerTier)
    .filter(([, v]) => !v.verified)
    .map(([t, v]) => `${v.value} exemplaires au niveau ${t}`);
  if (!rules.eliminatedPlayersReturnMinions.verified) {
    unverifiedRules.push('serviteurs des joueurs éliminés rendus au pool');
  }
  return {
    tiers: pool.tiers,
    byTribe: pool.byTribe,
    lobbyComplete: pool.lobbyComplete,
    unverifiedRules,
    cards,
  };
}
