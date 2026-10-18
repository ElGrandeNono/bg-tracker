/** Modèle d'entrée et de sortie du simulateur de combat. */

export interface SimMinionInput {
  readonly cardId: string;
  readonly attack: number;
  readonly health: number;
  /** Niveau de taverne de la carte (1 pour un jeton), pour les dégâts au héros. */
  readonly tier: number;
  readonly golden?: boolean;
  readonly taunt?: boolean;
  readonly divineShield?: boolean;
  readonly reborn?: boolean;
  readonly venomous?: boolean;
  readonly windfury?: boolean;
  readonly stealth?: boolean;
  /**
   * Carte d'origine (sans améliorations), pour la Réincarnation : le serviteur revient avec ces
   * caractéristiques et 1 PV (constaté dans le log : un Gardien de bronze réincarné retrouve son
   * Bouclier divin). Absent : on réutilise l'état courant (approximation).
   */
  readonly base?:
    | {
        readonly attack: number;
        readonly taunt: boolean;
        readonly divineShield: boolean;
        readonly venomous: boolean;
        readonly windfury: boolean;
      }
    | undefined;
  /** Tribus canoniques (forme `BACON_SUBSET_` : MURLOC, MECH…), pour les effets qui les ciblent. */
  readonly tribes?: readonly string[];
  /**
   * La carte a un effet de combat (Râle d'agonie, Début du combat, déclencheur…) que le
   * registre ne sait pas simuler : le résultat sera marqué « approximatif ».
   */
  readonly unsupportedEffect?: boolean;
}

export interface SimSideInput {
  readonly minions: readonly SimMinionInput[];
  readonly tavernTier: number;
  /** PV + armure du héros, pour la probabilité de létal (facultatif). */
  readonly heroHealth?: number | undefined;
}

export interface SimInput {
  /** Joueur local. */
  readonly a: SimSideInput;
  /** Adversaire. */
  readonly b: SimSideInput;
  /**
   * Plafond de dégâts du combat (`BACON_COMBAT_DAMAGE_CAP` quand
   * `BACON_COMBAT_DAMAGE_CAP_ENABLED=1` sur GameEntity) ; absent = pas de plafond.
   */
  readonly damageCap?: number;
}

export type CombatResult = 'win' | 'tie' | 'loss';

export interface CombatOutcome {
  /** Du point de vue de `a` (joueur local). */
  readonly result: CombatResult;
  /** Dégâts infligés au héros perdant (0 en cas d'égalité). */
  readonly damage: number;
  /** Nombre d'attaques jouées (diagnostic). */
  readonly attacks: number;
}

export interface SimSummary {
  readonly iterations: number;
  readonly win: number;
  readonly tie: number;
  readonly loss: number;
  /** Probabilité que le local tue l'adversaire / soit tué (si les PV sont connus). */
  readonly lethalForA: number | undefined;
  readonly lethalForB: number | undefined;
  /** Dégâts reçus par l'adversaire quand le local gagne, et inversement. */
  readonly damageToB:
    { readonly min: number; readonly avg: number; readonly max: number } | undefined;
  readonly damageToA:
    { readonly min: number; readonly avg: number; readonly max: number } | undefined;
  /** Vrai si au moins une carte a un effet non simulé : résultat indicatif seulement. */
  readonly approximate: boolean;
  readonly unsupportedCards: readonly string[];
}
