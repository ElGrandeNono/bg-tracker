import type { ShopEnchantment } from '@bgt/core';
import type { TavernBuff } from '../shared/payload.js';

/**
 * Bonus des serviteurs de la taverne, suivis d'après les ENCHANTEMENTS posés sur les serviteurs de
 * la boutique affichée (`view.shopEnchantments`) : la carte d'enchantement donne la source, ses
 * `TAG_SCRIPT_DATA_NUM_1/2` la valeur (vérifié sur les gemmes de sang `BG20_GEMe`, voir
 * core/visibility/view.ts). Un enchantement porté par un seul serviteur est un bonus isolé, pas un
 * bonus de taverne. La dernière valeur vue reste affichée pour la partie (la boutique peut être
 * vide ou ne pas contenir de serviteur concerné). Deux enchantements de même valeur sur les mêmes
 * serviteurs n'en font qu'un : les gemmes de sang posent `BG20_GEMe` (stats, « invisible banner »
 * selon HearthstoneJSON) et `BG20_GEMe2` (bannière « Blood Gems » affichée) ; on garde le dernier.
 */
export function trackTavernBuffs(
  memory: ReadonlyMap<string, TavernBuff>,
  seen: readonly ShopEnchantment[],
): Map<string, TavernBuff> {
  const next = new Map(memory);
  const kept = new Set<string>();
  for (const e of [...seen].sort((a, b) => (a.cardId < b.cardId ? 1 : -1))) {
    const key = `${e.attack}/${e.health}/${e.minions}`;
    if (e.minions < 2 || kept.has(key)) continue;
    kept.add(key);
    next.set(e.cardId, { source: e.cardId, attack: e.attack, health: e.health });
  }
  return next;
}
