import type { BgGame } from '../bg/bgGame.js';
import type { PowerEvent } from '../power/types.js';
import type { GameState } from '../state/gameState.js';

/**
 * Contrat d'un module de saison (seasons/sNN). Le cœur ne connaît aucune mécanique saisonnière :
 * il fait avancer l'état du module à chaque événement, le retient avec le reste par l'horloge
 * d'affichage, et insère sa vue dans la vue filtrée.
 *
 * Le module est responsable de ne mettre dans sa vue QUE ce que le joueur voit (ses trinkets,
 * ses dons, ses compteurs…) et de lister toutes les cartes qu'il y cite dans `shownCardIds`,
 * contrôlées par le test fair-play.
 */

export interface SeasonViewBase {
  readonly seasonId: string;
  /** Toutes les cartes citées dans la vue de saison (vérifiées par le test fair-play). */
  readonly shownCardIds: readonly string[];
}

export interface SeasonModule<S, V extends SeasonViewBase> {
  readonly id: string;
  readonly initial: S;
  /** `prev`/`next` : état brut avant et après `event` ; `bg` : modèle BG après l'événement. */
  reduce(state: S, event: PowerEvent, prev: GameState, next: GameState, bg: BgGame): S;
  view(state: S, bg: BgGame, game: GameState): V;
}

/** Module de saison sous forme non typée, pour le pipeline (état opaque). */
export type AnySeasonModule = SeasonModule<unknown, SeasonViewBase>;
