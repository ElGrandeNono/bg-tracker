import type { CombatContext, Minion, Side } from './engine.js';

/**
 * Registre des effets de cartes, piloté par les données : une entrée par cardId (version normale),
 * la version dorée étant traitée par `golden`. Chaque entrée cite le texte de la carte
 * (HearthstoneJSON frFR, build 254477, consulté le 19/10/2026) et a un test dédié
 * (registry.test.ts). Liste à jour : docs/simulator-coverage.md.
 *
 * Une carte dont les `mechanics` HearthstoneJSON contiennent un effet de combat et qui n'est PAS
 * ici rend le résultat « approximatif » (voir `effectStatus`).
 */

export interface CardEffects {
  /** Texte de référence (abrégé) et raison du traitement. */
  readonly note: string;
  /** Râle d'agonie : `position` = place qu'occupait le serviteur mort. */
  readonly deathrattle?: (ctx: CombatContext, side: Side, position: number, self: Minion) => void;
  /** Vrai si la carte n'a aucun effet pendant le combat (cartes en main, taverne…). */
  readonly noCombatEffect?: boolean;
}

export type EffectRegistry = ReadonlyMap<string, CardEffects>;

const MICROBOT = { cardId: 'BG_BOT_312t', tier: 1 } as const;

const ENTRIES: Record<string, CardEffects> = {
  BG29_611: {
    note: 'Tireur de câble — « Râle d’agonie : invoque un microbot 1/1 » (doré : 2/2).',
    deathrattle: (ctx, side, position, self) => {
      const s = self.golden ? 2 : 1;
      ctx.summon(side, position, { ...MICROBOT, attack: s, health: s, golden: self.golden });
    },
  },
  // Râles d'agonie qui ne donnent que des cartes en main ou agissent sur la taverne :
  // aucun effet sur le combat en cours.
  BG32_336: {
    note: 'Gourmet gormelin — Râle d’agonie : obtenez un ragoût de la mer (en main).',
    noCombatEffect: true,
  },
  BG34_171: {
    note: 'Assemblage porteur — Râle d’agonie : obtenez un volumateur (en main).',
    noCombatEffect: true,
  },
  BG34_856: {
    note: 'Être aqueux — Râle d’agonie : +4/+4 à un serviteur de la taverne.',
    noCombatEffect: true,
  },
  BG35_881: {
    note: 'Raboteur de ligne tellurique — Râle d’agonie : obtenez une absorption des arcanes.',
    noCombatEffect: true,
  },
  BG32_170: {
    note: 'Chasseur métallique — Râle d’agonie : obtenez une flèche aiguisée.',
    noCombatEffect: true,
  },
};

/** Registre par défaut ; les versions dorées (`_G`) pointent vers la même entrée. */
export const DEFAULT_REGISTRY: EffectRegistry = new Map(
  Object.entries(ENTRIES).flatMap(([id, e]) => [
    [id, e],
    [`${id}_G`, e],
  ]),
);

/**
 * Mécaniques HearthstoneJSON susceptibles d'agir pendant le combat. `TRIGGER_VISUAL` couvre aussi
 * des déclencheurs de recrutement : prudence, la carte est alors signalée comme non simulée.
 */
export const COMBAT_MECHANICS: ReadonlySet<string> = new Set([
  'DEATHRATTLE',
  'InvisibleDeathrattle',
  'START_OF_COMBAT',
  'AVENGE',
  'AURA',
  'TRIGGER_VISUAL',
  'BACON_RALLY',
]);

export type EffectStatus = 'none' | 'supported' | 'unsupported';

/** Statut de simulation d'une carte, d'après ses `mechanics` et le registre. */
export function effectStatus(
  cardId: string,
  mechanics: readonly string[] | undefined,
  registry: EffectRegistry = DEFAULT_REGISTRY,
): EffectStatus {
  if (registry.has(cardId)) return 'supported';
  if (mechanics === undefined) return 'unsupported'; // carte inconnue : prudence
  return mechanics.some((m) => COMBAT_MECHANICS.has(m)) ? 'unsupported' : 'none';
}
