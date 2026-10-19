import type { VisibleMinion } from '@bgt/core';
import type { TavernBuff } from '../shared/payload.js';

/**
 * Bonus des serviteurs de la taverne (effets du type « les serviteurs de la taverne ont +1/+1 »).
 * Aucun tag du log ne les donne : on compare les serviteurs de la boutique AFFICHÉE à leurs stats
 * de base (HearthstoneJSON). Résultat : un bonus commun à toute la boutique (`ALL`), puis le
 * supplément propre à une tribu. Le minimum par groupe écarte un serviteur buffé isolément.
 * Les serviteurs dorés sont ignorés (stats de base doublées, autre carte).
 */

export interface BaseCard {
  readonly attack: number;
  readonly health: number;
  /** Tribus canoniques ; vide = neutre. */
  readonly tribes: readonly string[];
}

export function tavernBuffs(
  shop: readonly VisibleMinion[],
  base: (cardId: string) => BaseCard | undefined,
): TavernBuff[] {
  const deltas: { tribes: readonly string[]; attack: number; health: number }[] = [];
  for (const m of shop) {
    const b = base(m.cardId);
    if (m.golden || b === undefined || m.attack === undefined || m.health === undefined) continue;
    deltas.push({ tribes: b.tribes, attack: m.attack - b.attack, health: m.health - b.health });
  }
  if (deltas.length === 0) return [];
  const min = (xs: readonly { attack: number; health: number }[]): TavernBuff => ({
    tribe: 'ALL',
    attack: Math.max(0, Math.min(...xs.map((x) => x.attack))),
    health: Math.max(0, Math.min(...xs.map((x) => x.health))),
  });
  const all = min(deltas);
  const out: TavernBuff[] = all.attack > 0 || all.health > 0 ? [all] : [];
  const tribes = [...new Set(deltas.flatMap((d) => d.tribes))].sort();
  for (const tribe of tribes) {
    const t = min(deltas.filter((d) => d.tribes.includes(tribe)));
    const attack = t.attack - all.attack;
    const health = t.health - all.health;
    if (attack > 0 || health > 0) out.push({ tribe, attack, health });
  }
  return out;
}
