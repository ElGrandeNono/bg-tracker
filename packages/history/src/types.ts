import type { GameMode, Outcome, VisibleMinion } from '@bgt/core';

/**
 * Une partie enregistrée. Tout provient de la vue FILTRÉE (ce que le joueur a vu) : aucun champ
 * n'est lu dans l'état brut du jeu.
 */
export interface GameRecord {
  /** Identifiant SQLite (absent avant insertion). */
  readonly id?: number;
  /** Clé d'unicité : évite les doublons quand un même log est importé deux fois. */
  readonly key: string;
  /** Début de la partie (ISO 8601, heure locale du joueur) si connu. */
  readonly startedAt: string | undefined;
  readonly build: string | undefined;
  readonly mode: GameMode;
  readonly heroCardId: string;
  /** Héros de base (skin ramené au héros), renseigné par l'application via les données de cartes. */
  readonly heroBaseCardId: string;
  readonly outcome: Outcome;
  /** Place finale ; absente pour une partie abandonnée ou interrompue. */
  readonly finalPlace: number | undefined;
  /** Tribus du lobby identifiées à la fin de la partie. */
  readonly tribes: readonly string[];
  readonly rounds: number;
  readonly durationMs: number | undefined;
  readonly truncated: boolean;
  /** Saisie manuelle facultative : le MMR n'est pas dans les logs. */
  readonly mmr: number | undefined;
  readonly notes: string;
  readonly tags: readonly string[];
  /** Instantanés par tour, pour le replay (ce qui était visible). */
  readonly replay: readonly ReplayRound[];
}

export interface ReplayRound {
  readonly round: number;
  readonly techLevel: number | undefined;
  readonly health: number | undefined;
  readonly armor: number | undefined;
  readonly triples: number | undefined;
  readonly gold: number | undefined;
  /** Ton plateau au début du combat (figé à la première attaque). */
  readonly localBoard: readonly VisibleMinion[];
  readonly opponent:
    | {
        readonly playerId: number;
        readonly heroCardId: string;
        readonly name: string | undefined;
        readonly board: readonly VisibleMinion[];
      }
    | undefined;
  /** Classement affiché à ce moment (playerId → place). */
  readonly places: Readonly<Record<number, number>>;
}

/** Champs modifiables par le joueur. */
export interface GameEdit {
  readonly mmr?: number | undefined;
  readonly notes?: string;
  readonly tags?: readonly string[];
}
