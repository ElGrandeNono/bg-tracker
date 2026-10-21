/**
 * Événements extraits de `GameState.DebugPrintPower()` et `GameState.DebugPrintGame()`.
 *
 * Les tags sont gardés tels que le jeu les écrit : par leur nom quand le client le connaît
 * (`PLAYER_TECH_LEVEL`), sinon par leur identifiant numérique en chaîne (`"3085"`).
 * Un tag inconnu n'est jamais une erreur.
 */

/** Valeur de tag : entier quand la valeur est numérique, sinon le nom d'énumération (`PLAY`). */
export type TagValue = number | string;

export type Tags = Readonly<Record<string, TagValue>>;

export type EntityRef =
  | { readonly kind: 'id'; readonly id: number }
  /** `GameEntity` ou un nom de joueur (`Joueur#0001`, `Bob le barman`, `Adversaire2`…). */
  | { readonly kind: 'name'; readonly name: string };

export interface EventPosition {
  /** Numéro de ligne (1-based) dans le flux lu. */
  readonly line: number;
  /** Millisecondes depuis minuit, heure locale du log. */
  readonly timeMs: number;
}

interface Base {
  readonly at: EventPosition;
}

export type PowerEvent =
  | (Base & { readonly type: 'createGame' })
  | (Base & { readonly type: 'gameEntity'; readonly id: number; readonly tags: Tags })
  | (Base & {
      readonly type: 'player';
      readonly id: number;
      readonly playerId: number;
      readonly accountHi: string;
      readonly accountLo: string;
      readonly tags: Tags;
    })
  | (Base & {
      readonly type: 'fullEntity';
      readonly id: number;
      readonly cardId: string;
      readonly tags: Tags;
    })
  | (Base & {
      readonly type: 'showEntity' | 'changeEntity';
      readonly ref: EntityRef;
      readonly cardId: string;
      readonly tags: Tags;
    })
  | (Base & {
      readonly type: 'hideEntity';
      readonly ref: EntityRef;
      readonly tag: string;
      readonly value: TagValue;
    })
  | (Base & {
      readonly type: 'tagChange';
      readonly ref: EntityRef;
      readonly tag: string;
      readonly value: TagValue;
    })
  | (Base & { readonly type: 'blockStart'; readonly blockType: string; readonly ref: EntityRef })
  | (Base & { readonly type: 'blockEnd' })
  /** Ligne `DebugPrintGame` de la forme `Clé=Valeur` (BuildNumber, GameType, FormatType, ScenarioID). */
  | (Base & { readonly type: 'gameInfo'; readonly key: string; readonly value: string })
  | (Base & { readonly type: 'playerName'; readonly playerId: number; readonly name: string })
  /**
   * Choix proposé à un joueur (`GameState.DebugPrintEntityChoices`) : héros au `MULLIGAN`,
   * Découvertes / bibelots en `GENERAL`. `cards` : cartes proposées et leur PlayerID.
   */
  | (Base & {
      readonly type: 'choices';
      readonly id: number;
      readonly choiceType: string;
      readonly cards: readonly { readonly cardId: string; readonly playerId: number }[];
    })
  /** Choix fait (`GameState.DebugPrintEntitiesChosen`), même `id` que la proposition. */
  | (Base & {
      readonly type: 'chosen';
      readonly id: number;
      readonly cards: readonly { readonly cardId: string; readonly playerId: number }[];
    })
  /** Le jeu a tronqué le fichier (limite de taille atteinte). */
  | (Base & { readonly type: 'truncated' })
  /** Plus rien ne viendra de ce flux (fin du fichier rejoué, ou session de jeu remplacée). */
  | (Base & { readonly type: 'endOfStream' })
  /** Repère d'affichage atteint par GameState (voir power/markers.ts). */
  | (Base & { readonly type: 'stateMarker'; readonly key: string })
  /** Le client (PowerTaskList) a affiché ce repère : il rattrape GameState. */
  | (Base & { readonly type: 'displayMarker'; readonly key: string });

export type PowerEventType = PowerEvent['type'];
