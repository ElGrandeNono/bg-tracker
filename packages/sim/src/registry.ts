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
  /**
   * À la mort, hors Râle d'agonie (non doublé par Titus) : ex. compteur « mort pendant cette
   * partie » du Chevalier éternel (mécanique `InvisibleDeathrattle`).
   */
  readonly onDeath?: (ctx: CombatContext, side: Side, self: Minion) => void;
  /** Après le retour par Réincarnation (stats d'aura à réappliquer, par ex.). */
  readonly onReborn?: (ctx: CombatContext, side: Side, self: Minion) => void;
  /** Déclenchements de Râle d'agonie EN PLUS accordés à son camp tant qu'il est vivant (Titus). */
  readonly extraDeathrattles?: (self: Minion) => number;
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
// Jetons vérifiés dans les logs de l'utilisateur (20 et 21/10/2026) et HearthstoneJSON.
const SKELETON = {
  cardId: 'BG_ICC_026t',
  tier: 1,
  tribes: ['UNDEAD'],
  attack: 1,
  health: 1,
} as const;
const BEETLE = { cardId: 'BG28_603t', tier: 1, tribes: ['BEAST'], attack: 2, health: 2 } as const;
const HUNTING_BAT = {
  cardId: 'BG36_200t',
  tier: 1,
  tribes: ['BEAST'],
  attack: 1,
  health: 1,
} as const;

const ETERNAL_KNIGHT = 'BG25_008';
/**
 * Chevaliers éternels alliés morts « pendant cette partie » : déduit au début du combat des
 * chevaliers présents (ATQ − ATQ de base) ÷ 4 (÷ 8 doré), le plus petit écart (un chevalier a pu
 * recevoir d'autres bonus) ; 0 sans chevalier. Puis tenu à jour pendant le combat.
 */
function knightDeaths(side: Side): number {
  const known = side.counters.get(ETERNAL_KNIGHT);
  if (known !== undefined) return known;
  const counts = side.board
    .filter((x) => x.cardId === ETERNAL_KNIGHT && !x.dead)
    .map((x) => Math.floor((x.attack - (x.golden ? 8 : 4)) / (x.golden ? 8 : 4)));
  const n = counts.length === 0 ? 0 : Math.max(0, Math.min(...counts));
  side.counters.set(ETERNAL_KNIGHT, n);
  return n;
}

function summonKnight(ctx: CombatContext, side: Side, position: number, golden: boolean): void {
  const n = knightDeaths(side);
  const step = golden ? 2 : 1;
  ctx.summon(side, position, {
    cardId: ETERNAL_KNIGHT,
    attack: 4 * step * (1 + n),
    health: 2 * step * (1 + n),
    tier: 2,
    golden,
    tribes: ['UNDEAD'],
    base: { attack: 4 * step, taunt: false, divineShield: false, venomous: false, windfury: false },
  });
}

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

  BG25_008: {
    note:
      'Chevalier éternel — « A +4/+2 pour chaque chevalier éternel allié mort pendant cette ' +
      'partie » (doré +8/+4) : à sa mort, les chevaliers alliés vivants gagnent le bonus.',
    onDeath: (_ctx, side, self) => {
      side.counters.set(ETERNAL_KNIGHT, knightDeaths(side) + 1);
      for (const k of side.alive()) {
        if (k === self || k.cardId !== ETERNAL_KNIGHT) continue;
        k.attack += k.golden ? 8 : 4;
        k.health += k.golden ? 4 : 2;
      }
    },
    // Revenu par Réincarnation (1 PV) : l'aura s'applique de nouveau (lecture du texte, non vérifié).
    onReborn: (_ctx, side, self) => {
      const n = knightDeaths(side);
      const step = self.golden ? 2 : 1;
      self.attack = 4 * step * (1 + n);
      self.health = 1 + 2 * step * n;
    },
  },
  BG25_009: {
    note: 'Invocatrice éternelle — « Râle d’agonie : invoque un chevalier éternel » (doré : doré).',
    deathrattle: (ctx, side, position, self) => {
      summonKnight(ctx, side, position, self.golden);
    },
  },
  BG25_354: {
    note: 'Titus Vaillefendre — « Vos Râles d’agonie se déclenchent une fois supplémentaire » (doré : 2).',
    extraDeathrattles: (self) => (self.golden ? 2 : 1),
  },
  BG28_309: {
    note:
      'Momification — « Râle d’agonie : confère Réincarnation à un autre Mort-vivant allié » ' +
      '(doré : 2). Choix au hasard parmi ceux qui ne l’ont pas (non vérifié).',
    deathrattle: (ctx, side, _position, self) => {
      for (let n = self.golden ? 2 : 1; n > 0; n--) {
        const c = side
          .alive()
          .filter((x) => x !== self && x.tribes.includes('UNDEAD') && !x.reborn);
        if (c.length === 0) return;
        ctx.rng.pick(c).reborn = true;
      }
    },
  },
  BG28_300: {
    note: 'Liche inoffensive — « Râle d’agonie : invoque deux squelettes 1/1 » (doré : quatre 1/1).',
    deathrattle: (ctx, side, position, self) => {
      for (let n = self.golden ? 4 : 2; n > 0; n--) ctx.summon(side, position, { ...SKELETON });
    },
  },
  BG31_803: {
    note: 'Insecte vrombissant — « Râle d’agonie : invoque un hanneton 2/2 » (doré : deux 2/2).',
    deathrattle: (ctx, side, position, self) => {
      for (let n = self.golden ? 2 : 1; n > 0; n--) ctx.summon(side, position, { ...BEETLE });
    },
  },
  BG36_200: {
    note:
      'Chauve-souris virevoltante — « Ralliement : invoque une Bête 1/1 » (doré : deux), ' +
      'à sa droite (position non vérifiée).',
    onAttack: (ctx, side, self) => {
      for (let n = self.golden ? 2 : 1; n > 0; n--) {
        ctx.summon(side, side.board.indexOf(self) + 1, { ...HUNTING_BAT });
      }
    },
  },

  // ---- Râles d'agonie sans effet sur le combat (cartes en main, taverne, Divinité hors combat)
  BG36_362: none('Garde-courroux sacrificiel — Râle d’agonie : +2/+2 à la taverne (partie).'),
  BG36_730: none('Sonneur piégé — Râle d’agonie : cartes Chair à démon aux actualisations.'),
  BG36_731: none('Diablonnettiste — Râle d’agonie : obtenez une Folie méthodique (main).'),
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
