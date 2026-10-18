import type { PoolRules } from '@bgt/core';

/**
 * Règles du pool de serviteurs, saison 14 (patch 36.2 → 37.x). Chaque valeur porte sa source ;
 * `verified: false` = sources discordantes ou non officielles, affiché comme tel dans l'UI.
 *
 * Sources (consultées le 18/10/2026) :
 * - [wiki] https://hearthstone.wiki.gg/wiki/Battlegrounds (copies, emplacements, effets sur le pool)
 * - [fandom] https://hearthstone.fandom.com/wiki/Battlegrounds (16 copies au niveau 1)
 * - [36.6] https://news.blizzard.com/en-us/article/24294373/36-6-patch-notes (Nagas retirés)
 * - [forum] https://us.forums.blizzard.com/en/hearthstone/t/bg-how-does-the-minion-pool-actually-work/138203
 */
export const S14_POOL_RULES: PoolRules = {
  copiesPerTier: {
    // [wiki] 15 ; [fandom] 16 : désaccord, retenu 15 (source la plus récente).
    1: { value: 15, verified: false },
    2: { value: 15, verified: true },
    3: { value: 13, verified: true },
    4: { value: 11, verified: true },
    5: { value: 9, verified: true },
    6: { value: 7, verified: true },
    7: { value: 5, verified: true },
  },
  // [wiki] « starts at 3 and is increased by 1 at tiers 2, 4 and 6 ». Niveau 7 : non précisé,
  // on garde 6.
  shopSlotsPerTier: { 1: 3, 2: 4, 3: 4, 4: 5, 5: 5, 6: 6, 7: 6 },
  // Observé : les 5 tribus réelles de la partie complète du 18/10/2026 (vérité terrain).
  tribesPerLobby: 5,
  // [36.6] Nagas retirés « temporairement » (36.6.1) ; confirmé par l'utilisateur pour 37.0 :
  // seuls les serviteurs à double type portant aussi une tribu du lobby restent jouables.
  excludedTribes: ['NAGA'],
  // [wiki] un doré compte pour ses 3 copies et les rend toutes à la vente.
  copiesPerGolden: 3,
  // [forum] affirmation de joueur, non officielle.
  eliminatedPlayersReturnMinions: { value: true, verified: false },
};
