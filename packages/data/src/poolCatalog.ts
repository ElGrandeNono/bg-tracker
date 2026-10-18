import { canonicalTribe, type PoolCard } from '@bgt/core';
import type { CardDb, CardInfo } from './cardDb.js';

/**
 * Catalogue du pool Battlegrounds SOLO à partir de HearthstoneJSON : serviteurs
 * `isBattlegroundsPoolMinion`, hors `isBattlegroundsDuosExclusive`. Vérifié le 18/10/2026 :
 * effectifs par niveau identiques au wiki pour les niveaux 2 à 7 (37/45/62/56/35/13 ; 25 contre
 * 24 au niveau 1). Les tribus hors rotation (Nagas cette saison) ne sont PAS retirées ici : c'est
 * le rôle des règles de saison (`excludedTribes`), car ce marqueur ne suit pas les rotations.
 */
export function buildPoolCatalog(db: CardDb): PoolCard[] {
  const out: PoolCard[] = [];
  for (const c of db.toJSON()) {
    if (!isSoloPoolMinion(c)) continue;
    const races = c.races.filter((r) => r !== 'INVALID');
    const golden =
      c.battlegroundsPremiumDbfId === undefined
        ? undefined
        : db.byDbfId(c.battlegroundsPremiumDbfId);
    out.push({
      id: c.id,
      tier: c.techLevel ?? 0,
      tribes: races.filter((r) => r !== 'ALL').map(canonicalTribe),
      allTribes: races.includes('ALL'),
      associatedTribes: c.battlegroundsAssociatedRaces.map(canonicalTribe),
      goldenId: golden?.id,
    });
  }
  return out;
}

export function isSoloPoolMinion(c: CardInfo): boolean {
  return (
    c.isBattlegroundsPoolMinion &&
    !c.isBattlegroundsDuosExclusive &&
    c.type === 'MINION' &&
    c.techLevel !== undefined
  );
}
