import type { EntityRef, PowerEvent, TagValue, Tags } from '../power/types.js';
import { IdMap } from './idMap.js';

/**
 * État brut d'une partie : toutes les entités et leurs tags, tel que le log les décrit.
 * Le reducer est pur : chaque événement produit un nouvel état, l'ancien reste valide.
 * Cet état contient des informations cachées (mains, boutiques adverses…) : il ne doit
 * JAMAIS atteindre l'UI sans passer par le filtre de visibilité.
 */

export interface Entity {
  readonly id: number;
  /** Vide tant que l'entité n'a pas été révélée (`UNKNOWN ENTITY [cardType=INVALID]`). */
  readonly cardId: string;
  readonly tags: Tags;
}

export interface PlayerSlot {
  readonly entityId: number;
  readonly playerId: number;
  readonly accountHi: string;
  readonly accountLo: string;
}

export interface GameState {
  /** Nombre de `CREATE_GAME` vus dans le flux (0 avant la première partie). */
  readonly gameIndex: number;
  readonly gameEntityId: number | undefined;
  readonly entities: IdMap<Entity>;
  /** Les deux entités `Player` déclarées dans `CREATE_GAME`. */
  readonly players: readonly PlayerSlot[];
  /** Noms issus de `DebugPrintGame` (`PlayerID=2, PlayerName=…`). */
  readonly playerNames: Readonly<Record<number, string>>;
  /** `BuildNumber`, `GameType`, `FormatType`, `ScenarioID`. */
  readonly info: Readonly<Record<string, string>>;
  /** Le jeu a tronqué le log : l'état peut être incomplet. */
  readonly truncated: boolean;
  /** TAG_CHANGE reçus pour une entité jamais créée (log commencé en cours de partie, etc.). */
  readonly orphanTagChanges: number;
}

export const initialGameState: GameState = {
  gameIndex: 0,
  gameEntityId: undefined,
  entities: IdMap.empty(),
  players: [],
  playerNames: {},
  info: {},
  truncated: false,
  orphanTagChanges: 0,
};

export function tagOf(entity: Entity | undefined, tag: string): TagValue | undefined {
  return entity?.tags[tag];
}

export function numTag(entity: Entity | undefined, tag: string): number | undefined {
  const v = entity?.tags[tag];
  return typeof v === 'number' ? v : undefined;
}

/** Joueur local : celui dont le `GameAccountId` est non nul (vérifié sur les deux fixtures). */
export function localPlayer(state: GameState): PlayerSlot | undefined {
  return state.players.find((p) => p.accountHi !== '0' || p.accountLo !== '0');
}

/**
 * Second joueur du log. En BG solo il ne représente pas un adversaire fixe : c'est un emplacement
 * dont le nom change (`Bob le barman` en recrutement, nom de l'adversaire en combat). Repéré par
 * `BACON_DUMMY_PLAYER=1`, à défaut par un `GameAccountId` nul.
 */
export function dummyPlayer(state: GameState): PlayerSlot | undefined {
  return (
    state.players.find((p) => numTag(state.entities.get(p.entityId), 'BACON_DUMMY_PLAYER') === 1) ??
    state.players.find((p) => p.accountHi === '0' && p.accountLo === '0')
  );
}

/**
 * Résout une référence d'entité. `GameEntity` → l'entité de jeu ; un nom présent dans
 * `DebugPrintGame` → ce joueur ; tout autre nom → l'emplacement « dummy » (voir `dummyPlayer`).
 */
export function resolveRef(state: GameState, ref: EntityRef): number | undefined {
  if (ref.kind === 'id') return ref.id;
  if (ref.name === 'GameEntity') return state.gameEntityId;
  for (const p of state.players) {
    if (state.playerNames[p.playerId] === ref.name) return p.entityId;
  }
  return dummyPlayer(state)?.entityId;
}

function upsert(
  state: GameState,
  id: number,
  update: (prev: Entity | undefined) => Entity,
): GameState {
  return { ...state, entities: state.entities.set(id, update(state.entities.get(id))) };
}

function withTag(prev: Entity | undefined, id: number, tag: string, value: TagValue): Entity {
  if (prev?.tags[tag] === value) return prev;
  return { id, cardId: prev?.cardId ?? '', tags: { ...prev?.tags, [tag]: value } };
}

export function reduceGameState(state: GameState, event: PowerEvent): GameState {
  switch (event.type) {
    case 'createGame':
      // Nouvelle partie dans le même fichier. Une troncature, elle, ne remet jamais l'état à zéro.
      return { ...initialGameState, gameIndex: state.gameIndex + 1 };
    case 'gameEntity':
      return {
        ...upsert(state, event.id, () => ({ id: event.id, cardId: '', tags: event.tags })),
        gameEntityId: event.id,
      };
    case 'player': {
      const slot: PlayerSlot = {
        entityId: event.id,
        playerId: event.playerId,
        accountHi: event.accountHi,
        accountLo: event.accountLo,
      };
      return {
        ...upsert(state, event.id, () => ({ id: event.id, cardId: '', tags: event.tags })),
        players: [...state.players.filter((p) => p.entityId !== event.id), slot],
      };
    }
    case 'fullEntity':
      return upsert(state, event.id, () => ({
        id: event.id,
        cardId: event.cardId,
        tags: event.tags,
      }));
    case 'showEntity':
    case 'changeEntity': {
      const id = resolveRef(state, event.ref);
      if (id === undefined) return state;
      return upsert(state, id, (prev) => ({
        id,
        cardId: event.cardId,
        tags: { ...prev?.tags, ...event.tags },
      }));
    }
    case 'hideEntity':
    case 'tagChange': {
      const id = resolveRef(state, event.ref);
      if (id === undefined) return state;
      const prev = state.entities.get(id);
      const next = withTag(prev, id, event.tag, event.value);
      if (next === prev) return state;
      return {
        ...state,
        entities: state.entities.set(id, next),
        orphanTagChanges: prev === undefined ? state.orphanTagChanges + 1 : state.orphanTagChanges,
      };
    }
    case 'gameInfo':
      return { ...state, info: { ...state.info, [event.key]: event.value } };
    case 'playerName':
      return { ...state, playerNames: { ...state.playerNames, [event.playerId]: event.name } };
    case 'truncated':
      return { ...state, truncated: true };
    case 'blockStart':
    case 'blockEnd':
    case 'endOfStream':
      return state;
  }
}
