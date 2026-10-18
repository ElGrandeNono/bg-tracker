import type { CombatContext, Minion, Side } from './engine.js';

/**
 * Registre des effets de cartes, piloté par les données : une entrée par cardId de la version
 * NORMALE (l'appelant ramène les dorés à leur version normale et passe `golden`). Chaque entrée
 * cite le texte de la carte (HearthstoneJSON frFR, build 254477, consulté le 19/10/2026) et a un
 * test (engine.test.ts / registry.test.ts). Liste à jour : docs/simulator-coverage.md.
 *
 * Une carte dont les `mechanics` contiennent un effet de combat et qui n'est PAS ici rend le
 * résultat « approximatif » (voir `effectStatus`).
 */

export interface CardEffects {
  /** Texte de référence (abrégé) et raison du traitement. */
  readonly note: string;
  /** Râle d'agonie : `position` = place qu'occupait le serviteur mort. */
  readonly deathrattle?: (ctx: CombatContext, side: Side, position: number, self: Minion) => void;
  /** Ralliement : « Chaque fois que ce serviteur attaque », avant les dégâts. */
  readonly onAttack?: (ctx: CombatContext, side: Side, self: Minion) => void;
  /** Après une attaque de ce serviteur qui a tué sa cible (`overkill` = dégâts en trop). */
  readonly afterKill?: (
    ctx: CombatContext,
    self: Minion,
    defender: Side,
    targetPosition: number,
    overkill: number,
  ) => void;
  /** Aucun effet pendant le combat (recrutement, main, taverne, fin de tour…). */
  readonly noCombatEffect?: boolean;
  /**
   * Effet de « Début du combat » uniquement : déjà résolu dans un plateau figé à la première
   * attaque (exact), mais pas dans un plateau de recrutement (approximatif).
   */
  readonly startOfCombatOnly?: boolean;
  /** La version dorée n'a pas de texte dans les données : simulée « approximative ». */
  readonly goldenUnverified?: boolean;
}

export type EffectRegistry = ReadonlyMap<string, CardEffects>;

const MICROBOT = { cardId: 'BG_BOT_312t', tier: 1, tribes: ['MECH'] } as const;

const none = (note: string): CardEffects => ({ note, noCombatEffect: true });
const soc = (note: string): CardEffects => ({ note, startOfCombatOnly: true });

const ENTRIES: Record<string, CardEffects> = {
  // ---- effets simulés
  BG29_611: {
    note: 'Tireur de câble — « Râle d’agonie : invoque un microbot 1/1 » (doré : 2/2).',
    deathrattle: (ctx, side, position, self) => {
      const s = self.golden ? 2 : 1;
      ctx.summon(side, position, { ...MICROBOT, attack: s, health: s, golden: self.golden });
    },
  },
  BG29_888: {
    note: 'Gardien de la lueur — « Ralliement : gagne +2 ATQ » (doré : +4).',
    onAttack: (_ctx, _side, self) => {
      self.attack += self.golden ? 4 : 2;
    },
  },
  BG33_318: {
    note:
      'Crache-bile — « Ralliement : confère Venimosité à un autre Murloc allié » (doré : 2). ' +
      'Choix au hasard parmi ceux qui n’en ont pas (non vérifié).',
    onAttack: (ctx, side, self) => {
      for (let n = self.golden ? 2 : 1; n > 0; n--) {
        const candidates = side
          .alive()
          .filter((m) => m !== self && m.tribes.includes('MURLOC') && !m.venomous);
        if (candidates.length === 0) return;
        ctx.rng.pick(candidates).venomous = true;
      }
    },
  },
  BGS_126: {
    note:
      'Élémentaire du feu de brousse — « Une fois que ce serviteur a attaqué et tué un serviteur, ' +
      'inflige tout surplus de dégâts à un adversaire adjacent » (adjacent choisi au hasard).',
    goldenUnverified: true,
    afterKill: (ctx, _self, defender, position, overkill) => {
      if (overkill <= 0) return;
      const adjacent = [defender.board[position - 1], defender.board[position + 1]].filter(
        (m): m is Minion => m !== undefined && !m.dead && m.health > 0,
      );
      if (adjacent.length === 0) return;
      ctx.damage(ctx.rng.pick(adjacent), overkill, undefined);
    },
  },

  // ---- Râles d'agonie sans effet sur le combat (cartes en main, taverne, Divinité hors combat)
  BG32_336: none('Gourmet gormelin — Râle d’agonie : obtenez un ragoût de la mer (en main).'),
  BG34_171: none('Assemblage porteur — Râle d’agonie : obtenez un volumateur (en main).'),
  BG34_856: none('Être aqueux — Râle d’agonie : +4/+4 à un serviteur de la taverne.'),
  BG35_881: none(
    'Raboteur de ligne tellurique — Râle d’agonie : obtenez une absorption des arcanes.',
  ),
  BG32_170: none('Chasseur métallique — Râle d’agonie : obtenez une flèche aiguisée.'),
  BG36_113: none('Sacrifice flottant — Râle d’agonie : +2/+1 à votre Divinité (hors combat).'),

  // ---- déclencheurs de recrutement, de main ou de fin de tour : aucun effet en combat
  BG36_703: none('Chasse-marée du Crépuscule — quand vous lancez un sort sur lui (recrutement).'),
  BG36_704: none('Mande-flots chamanique — quand vous lancez un sort sur un Murloc (recrutement).'),
  BG29_300: none(
    'Hivaileron affamé — quand il subit des dégâts, buffe un serviteur de votre MAIN.',
  ),
  BG35_814: none('Survivant écarlate — gagne Bouclier divin à 6 ATQ (déjà visible dans ses tags).'),
  TB_Baconups_202: none('Roche en fusion — quand vous jouez un Élémentaire (recrutement).'),
  BGS_127: none('Roche en fusion — quand vous jouez un Élémentaire (recrutement).'),
  BG26_147: none('Accordé-o-tron — or au début de votre tour.'),
  BG26_524: none('Malchezaar — actualisations payées en PV (recrutement).'),
  BG26_ICC_901: none('Enchanteresse drakkari — effets de fin de tour doublés.'),
  BG36_367: none('Réveil automatique — après 3 achats (recrutement).'),
  BG34_Giant_120: none('Interprète chronodistordu — quand vous jouez ou magnétisez un Méca.'),
  BG21_015: none('Tarecgosa — garde ses gains de combat (après le combat).'),
  BGS_004: none('Tisse-colère — quand vous jouez un Démon.'),
  BG26_174: none('Réenrouleur d’âme — après des dégâts à votre héros (fin du combat).'),
  BG32_873: none('Corrupteur cendreux — après des dégâts à votre héros (taverne).'),
  BG26_523: none('Tichondrius — après des dégâts à votre héros (fin du combat).'),
  BG36_360t6: none('Sombre paradoxe — aura de stats déjà comptée dans ses caractéristiques.'),
  BG_LOE_077: none('Brann Barbe-de-Bronze — Cris de guerre doublés.'),
  BG29_813: none('Poète invétéré — garde les gains de combat (après le combat).'),
  BG34_Giant_314: none('Poète chronodistordu — garde les gains de combat (après le combat).'),
  BG36_242: none('Marcheur du temps bronze — Ralliement : obtenez un chromadrake (en main).'),
  BG33_924: none('Dragonnet bleu — Ralliement : sorts de taverne +1 PV pour la partie.'),

  // ---- Début du combat : déjà résolu dans un plateau figé à la première attaque
  BG32_330: soc('Éclaireur véloce — Début du combat : depuis la main, en invoque une copie.'),
  BG27_556: soc('Fourrageur boueux — Début du combat : invoque un Murloc de votre main.'),
  BG34_142: soc('Victime de la mode — Début du combat : gagne l’ATQ d’un serviteur de votre main.'),
  BG24_500: soc('Veilleur d’ambre — Début du combat : +2/+2 et Bouclier divin à un Dragon.'),
  BG36_245: soc('Arcaniste runique — Début du combat : lance Anneau brillant deux fois.'),
  BG26_963: soc('Synthé électrique — Cri de guerre et Début du combat : +1/+1 à vos Dragons.'),
};

/** Registre par défaut ; `${id}_G` pointe aussi vers l'entrée (dorés de même cardId + `_G`). */
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

export interface EffectStatusOptions {
  readonly golden?: boolean;
  /** Le plateau est figé à la première attaque : les « Début du combat » sont déjà résolus. */
  readonly startOfCombatApplied?: boolean;
  readonly registry?: EffectRegistry;
}

/** Statut de simulation d'une carte, d'après ses `mechanics` et le registre. */
export function effectStatus(
  cardId: string,
  mechanics: readonly string[] | undefined,
  options: EffectStatusOptions = {},
): EffectStatus {
  const entry = (options.registry ?? DEFAULT_REGISTRY).get(cardId);
  if (entry !== undefined) {
    if (entry.startOfCombatOnly === true && options.startOfCombatApplied !== true)
      return 'unsupported';
    if (entry.goldenUnverified === true && options.golden === true) return 'unsupported';
    return 'supported';
  }
  if (mechanics === undefined) return 'unsupported'; // carte inconnue : prudence
  return mechanics.some((m) => COMBAT_MECHANICS.has(m)) ? 'unsupported' : 'none';
}
