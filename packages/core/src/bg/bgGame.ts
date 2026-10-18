import type { PowerEvent } from '../power/types.js';
import {
  dummyPlayer,
  localPlayer,
  numTag,
  resolveRef,
  tagOf,
  type Entity,
  type GameState,
} from '../state/gameState.js';
import {
  emptyTribeSightings,
  recordSighting,
  SUBSET_TAG_PREFIX,
  type TribeSightings,
} from './tribes.js';

/**
 * Modèle Battlegrounds dérivé de l'état brut. Chaque règle ci-dessous est tirée des fixtures
 * réelles (voir docs/log-format.md) ; ce qui n'y a pas été observé reste un point d'extension.
 *
 * - `TURN` sur GameEntity : impair = recrutement, pair = combat. Recrutement n = (TURN + 1) / 2.
 * - Chaque joueur du lobby est représenté par une entité HERO portant `PLAYER_ID` (id de
 *   classement) et `PLAYER_LEADERBOARD_PLACE` ; c'est elle qui porte `PLAYER_TECH_LEVEL`,
 *   `PLAYER_TRIPLES`, `HEALTH`/`DAMAGE`/`ARMOR`. Les copies de héros créées pour les combats
 *   portent aussi `PLAYER_ID` mais sont ignorées.
 * - Adversaire du combat : `BACON_CURRENT_COMBAT_PLAYER_ID` posé sur l'emplacement dummy ; le nom
 *   sous lequel le log désigne alors cet emplacement est celui de l'adversaire. Posé sur le
 *   joueur local, ce tag vaut l'id du joueur local lui-même ; 0 = fin du combat.
 * - Prochain adversaire : `NEXT_OPPONENT_PLAYER_ID` sur le joueur local (affiché en jeu).
 * - Place finale : dernière `PLAYER_LEADERBOARD_PLACE` du héros local quand il est éliminé.
 *   `PLAYSTATE=LOST` est reçu même dans le top 4 : il ne sert qu'à dater l'élimination.
 */

export type Phase = 'pending' | 'heroSelection' | 'recruit' | 'combat' | 'over';

export interface BgPlayer {
  /** Identifiant de classement (`PLAYER_ID` du héros). Change d'une partie à l'autre. */
  readonly playerId: number;
  readonly isLocal: boolean;
  readonly heroEntityId: number;
  readonly heroCardId: string;
  /** Nom appris quand le joueur a été affronté (le log ne le donne pas avant). */
  readonly name: string | undefined;
  readonly techLevel: number | undefined;
  readonly triples: number | undefined;
  readonly place: number | undefined;
  readonly health: number | undefined;
  readonly damage: number | undefined;
  readonly armor: number | undefined;
}

export interface CombatRecord {
  /** Valeur de `TURN` sur GameEntity (pair). */
  readonly gameTurn: number;
  /** Numéro du tour de recrutement qui précède ce combat. */
  readonly round: number;
  readonly opponentPlayerId: number | undefined;
  readonly opponentName: string | undefined;
  readonly startMs: number;
  readonly endMs: number | undefined;
  /** L'entrée `combatStart` a été ajoutée à la chronologie. */
  readonly announced: boolean;
  /**
   * Plateaux tels qu'affichés au début du combat : serviteurs entrés en `PLAY` une fois
   * l'adversaire connu, figés au premier bloc `ATTACK`. Les effets de « Début du combat »
   * déjà résolus avant la première attaque y sont inclus.
   */
  readonly opponentBoard: readonly BoardMinion[];
  readonly localBoard: readonly BoardMinion[];
  readonly boardsLocked: boolean;
}

export interface BoardMinion {
  readonly entityId: number;
  readonly cardId: string;
  readonly attack: number | undefined;
  /** Points de vie restants (`HEALTH - DAMAGE`). */
  readonly health: number | undefined;
  readonly position: number | undefined;
  readonly golden: boolean;
  /** Tags bruts utiles au simulateur (M5) : mots-clés, etc. */
  readonly tags: Readonly<Record<string, number | string>>;
}

export type TimelineEntry =
  | { readonly kind: 'gameStart'; readonly timeMs: number; readonly build: string | undefined }
  | { readonly kind: 'heroPicked'; readonly timeMs: number; readonly cardId: string }
  | { readonly kind: 'recruit'; readonly timeMs: number; readonly round: number }
  | {
      readonly kind: 'combatStart';
      readonly timeMs: number;
      readonly round: number;
      readonly opponentPlayerId: number | undefined;
      readonly opponentName: string | undefined;
    }
  | {
      readonly kind: 'combatEnd';
      readonly timeMs: number;
      readonly round: number;
      /** Places de chaque joueur à la fin du combat (`playerId` → place). */
      readonly places: Readonly<Record<number, number>>;
      readonly localHealth: number | undefined;
    }
  | {
      readonly kind: 'techLevel';
      readonly timeMs: number;
      readonly playerId: number;
      readonly level: number;
    }
  | {
      readonly kind: 'triple';
      readonly timeMs: number;
      readonly playerId: number;
      readonly total: number;
    }
  | { readonly kind: 'eliminated'; readonly timeMs: number; readonly place: number | undefined }
  | { readonly kind: 'gameOver'; readonly timeMs: number }
  | { readonly kind: 'truncated'; readonly timeMs: number; readonly line: number }
  | { readonly kind: 'interrupted'; readonly timeMs: number };

/**
 * - `finished` : élimination du héros local ou `STATE=COMPLETE` vus dans le log ;
 * - `interrupted` : « abandonnée ou interrompue ». Le flux s'est arrêté (fin du fichier, session
 *   de jeu remplacée) ou une nouvelle partie a commencé sans aucun événement de fin. C'est le
 *   cas d'un ABANDON volontaire : la fixture du 18/10 (partie courte) ne contient ni
 *   `PLAYSTATE=LOST`/`CONCEDED`, ni mort du héros, et s'arrête au milieu d'une liste de tâches.
 *   Jamais de place finale dans ce cas. Un simple silence du log ne suffit pas : le joueur
 *   peut réfléchir ; seule la fin du flux ou une nouvelle partie tranche.
 */
export type Outcome = 'inProgress' | 'finished' | 'interrupted';

export interface BgGame {
  readonly gameIndex: number;
  readonly isBattlegrounds: boolean;
  readonly build: string | undefined;
  readonly phase: Phase;
  readonly outcome: Outcome;
  /** Valeur courante de `TURN` sur GameEntity. */
  readonly gameTurn: number;
  /** Tour de recrutement courant (1, 2, 3…). */
  readonly round: number;
  readonly localPlayerId: number | undefined;
  readonly players: Readonly<Record<number, BgPlayer>>;
  readonly combats: readonly CombatRecord[];
  readonly nextOpponentPlayerId: number | undefined;
  readonly tribes: TribeSightings;
  readonly finalPlace: number | undefined;
  readonly truncated: boolean;
  readonly timeline: readonly TimelineEntry[];
  /** Noms sous lesquels l'emplacement dummy apparaît hors combat (`Bob le barman`…). */
  readonly dummyIdleNames: readonly string[];
}

export const initialBgGame: BgGame = {
  gameIndex: 0,
  isBattlegrounds: false,
  build: undefined,
  phase: 'pending',
  outcome: 'inProgress',
  gameTurn: 0,
  round: 0,
  localPlayerId: undefined,
  players: {},
  combats: [],
  nextOpponentPlayerId: undefined,
  tribes: emptyTribeSightings,
  finalPlace: undefined,
  truncated: false,
  timeline: [],
  dummyIdleNames: [],
};

const VISIBLE_MINION_ZONES = new Set(['PLAY', 'HAND']);

function push(bg: BgGame, entry: TimelineEntry): BgGame {
  return { ...bg, timeline: [...bg.timeline, entry] };
}

function playerFromHero(hero: Entity, isLocal: boolean, prev: BgPlayer | undefined): BgPlayer {
  return {
    playerId: numTag(hero, 'PLAYER_ID') ?? prev?.playerId ?? 0,
    isLocal,
    heroEntityId: hero.id,
    heroCardId: hero.cardId,
    name: prev?.name,
    techLevel: numTag(hero, 'PLAYER_TECH_LEVEL'),
    triples: numTag(hero, 'PLAYER_TRIPLES'),
    place: numTag(hero, 'PLAYER_LEADERBOARD_PLACE'),
    health: numTag(hero, 'HEALTH'),
    damage: numTag(hero, 'DAMAGE'),
    armor: numTag(hero, 'ARMOR'),
  };
}

/** Points de vie restants (sans l'armure), si connus. */
export function remainingHealth(p: BgPlayer | undefined): number | undefined {
  if (p?.health === undefined) return undefined;
  return p.health - (p.damage ?? 0);
}

function touchedEntityId(state: GameState, event: PowerEvent): number | undefined {
  switch (event.type) {
    case 'fullEntity':
    case 'gameEntity':
    case 'player':
      return event.id;
    case 'showEntity':
    case 'changeEntity':
    case 'hideEntity':
    case 'tagChange':
      return resolveRef(state, event.ref);
    default:
      return undefined;
  }
}

/**
 * Fait avancer le modèle BG d'un événement. `prev` et `next` sont les états bruts avant et après
 * `event` (calculés par `reduceGameState`).
 */
export function reduceBgGame(
  bg: BgGame,
  event: PowerEvent,
  prev: GameState,
  next: GameState,
): BgGame {
  const t = event.at.timeMs;

  if (next.gameIndex !== bg.gameIndex) {
    bg = { ...initialBgGame, gameIndex: next.gameIndex };
  }
  if (event.type === 'truncated') {
    return push({ ...bg, truncated: true }, { kind: 'truncated', timeMs: t, line: event.at.line });
  }
  if (event.type === 'endOfStream') return markInterrupted(bg, t);
  if (event.type === 'gameInfo') {
    if (event.key === 'GameType')
      bg = { ...bg, isBattlegrounds: event.value === 'GT_BATTLEGROUNDS' };
    if (event.key === 'BuildNumber') {
      bg = push(
        { ...bg, build: event.value },
        { kind: 'gameStart', timeMs: t, build: event.value },
      );
    }
    return bg;
  }

  if (event.type === 'blockStart' && event.blockType === 'ATTACK') {
    const last = bg.combats.at(-1);
    if (last !== undefined && last.endMs === undefined && !last.boardsLocked) {
      bg = { ...bg, combats: [...bg.combats.slice(0, -1), { ...last, boardsLocked: true }] };
    }
    return bg;
  }

  const id = touchedEntityId(next, event);
  if (id === undefined) return bg;
  const entity = next.entities.get(id);
  if (entity === undefined) return bg;
  const before = prev.entities.get(id);
  const changed = (tag: string): boolean => tagOf(before, tag) !== tagOf(entity, tag);

  const local = localPlayer(next);
  const dummy = dummyPlayer(next);

  // Cycle de partie : TURN et phase de combat sur GameEntity.
  if (id === next.gameEntityId) {
    if (changed('TURN')) {
      const gameTurn = numTag(entity, 'TURN') ?? 0;
      const round = Math.ceil(gameTurn / 2);
      bg = { ...bg, gameTurn, round };
      if (gameTurn % 2 === 1)
        bg = push({ ...bg, phase: 'recruit' }, { kind: 'recruit', timeMs: t, round });
    }
    if (changed('BACON_IN_COMBAT_PHASE')) {
      if (numTag(entity, 'BACON_IN_COMBAT_PHASE') === 1) {
        const combat: CombatRecord = {
          gameTurn: bg.gameTurn,
          round: bg.round,
          opponentPlayerId: undefined,
          opponentName: undefined,
          startMs: t,
          endMs: undefined,
          announced: false,
          opponentBoard: [],
          localBoard: [],
          boardsLocked: false,
        };
        bg = { ...bg, phase: 'combat', combats: [...bg.combats, combat] };
      } else {
        bg = endCombat(bg, t);
      }
    }
    if (changed('STATE') && tagOf(entity, 'STATE') === 'COMPLETE') {
      bg = push({ ...bg, phase: 'over', outcome: 'finished' }, { kind: 'gameOver', timeMs: t });
    }
    if (bg.phase === 'pending' && tagOf(entity, 'STEP') === 'BEGIN_MULLIGAN') {
      bg = { ...bg, phase: 'heroSelection' };
    }
    return bg;
  }

  // Joueur local : héros choisi, prochain adversaire, élimination.
  if (local !== undefined && id === local.entityId) {
    if (changed('NEXT_OPPONENT_PLAYER_ID')) {
      bg = { ...bg, nextOpponentPlayerId: numTag(entity, 'NEXT_OPPONENT_PLAYER_ID') };
    }
    if (changed('HERO_ENTITY')) bg = refreshLocalHero(bg, next, t);
    const ps = tagOf(entity, 'PLAYSTATE');
    if (changed('PLAYSTATE') && (ps === 'LOST' || ps === 'WON' || ps === 'CONCEDED')) {
      bg = eliminate(bg, t);
    }
    return bg;
  }

  // Emplacement dummy : adversaire du combat en cours.
  if (dummy !== undefined && id === dummy.entityId) {
    const name = 'ref' in event && event.ref.kind === 'name' ? event.ref.name : undefined;
    // `TURN` passe au recrutement suivant AVANT la fin du combat : on se fie au combat ouvert.
    const combatOpen = bg.combats.at(-1)?.endMs === undefined && bg.combats.length > 0;
    if (name !== undefined && !combatOpen && !bg.dummyIdleNames.includes(name)) {
      // Noms de l'emplacement hors combat (`Bob`, `Bob le barman`… selon la langue).
      bg = { ...bg, dummyIdleNames: [...bg.dummyIdleNames, name] };
    }
    if (changed('BACON_CURRENT_COMBAT_PLAYER_ID')) {
      const opp = numTag(entity, 'BACON_CURRENT_COMBAT_PLAYER_ID') ?? 0;
      if (opp !== 0) bg = updateCurrentCombat(bg, { opponentPlayerId: opp }, t);
    }
    // Le renommage de l'emplacement peut précéder (18/10) ou suivre (21/09) le tag d'adversaire :
    // le premier nom hors `dummyIdleNames` vu pendant le combat est celui de l'adversaire.
    if (name !== undefined && combatOpen && !bg.dummyIdleNames.includes(name)) {
      bg = updateCurrentCombat(bg, { opponentName: name }, t);
    }
    return bg;
  }

  // Héros du classement.
  if (tagOf(entity, 'CARDTYPE') === 'HERO') {
    bg = updateLeaderboardHero(bg, entity, next, t);
    if (bg.localPlayerId !== undefined && bg.players[bg.localPlayerId]?.heroEntityId === id) {
      if (changed('ZONE') && tagOf(entity, 'ZONE') === 'GRAVEYARD') bg = eliminate(bg, t);
    }
    return bg;
  }

  // Serviteurs visibles : plateaux de début de combat, puis tribus.
  if (tagOf(entity, 'CARDTYPE') === 'MINION' && entity.cardId !== '') {
    bg = captureBoardMinion(bg, entity, local?.playerId, dummy?.playerId);
    const zone = tagOf(entity, 'ZONE');
    if (typeof zone === 'string' && VISIBLE_MINION_ZONES.has(zone)) {
      const tribes = Object.keys(entity.tags)
        .filter((k) => k.startsWith(SUBSET_TAG_PREFIX) && entity.tags[k] === 1)
        .map((k) => k.slice(SUBSET_TAG_PREFIX.length));
      if (tribes.length > 0) {
        const sightings = recordSighting(bg.tribes, tribes, entity.cardId);
        if (sightings !== bg.tribes) bg = { ...bg, tribes: sightings };
      }
    }
  }
  return bg;
}

function captureBoardMinion(
  bg: BgGame,
  minion: Entity,
  localId: number | undefined,
  dummyId: number | undefined,
): BgGame {
  const last = bg.combats.at(-1);
  if (last === undefined || last.endMs !== undefined || last.boardsLocked) return bg;
  if (last.opponentPlayerId === undefined) return bg;
  const controller = numTag(minion, 'CONTROLLER');
  const side =
    controller === dummyId ? 'opponentBoard' : controller === localId ? 'localBoard' : undefined;
  if (side === undefined) return bg;
  const board = last[side].filter((m) => m.entityId !== minion.id);
  const inPlay = tagOf(minion, 'ZONE') === 'PLAY';
  const health = numTag(minion, 'HEALTH');
  const next = inPlay
    ? [
        ...board,
        {
          entityId: minion.id,
          cardId: minion.cardId,
          attack: numTag(minion, 'ATK'),
          health: health === undefined ? undefined : health - (numTag(minion, 'DAMAGE') ?? 0),
          position: numTag(minion, 'ZONE_POSITION'),
          golden: numTag(minion, 'PREMIUM') === 1 || minion.cardId.endsWith('_G'),
          tags: minion.tags,
        },
      ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : board;
  if (!inPlay && board.length === last[side].length) return bg;
  return { ...bg, combats: [...bg.combats.slice(0, -1), { ...last, [side]: next }] };
}

function refreshLocalHero(bg: BgGame, state: GameState, t: number): BgGame {
  const local = localPlayer(state);
  const heroId = numTag(state.entities.get(local?.entityId ?? -1), 'HERO_ENTITY');
  const hero = heroId === undefined ? undefined : state.entities.get(heroId);
  if (hero === undefined || hero.cardId === '' || hero.cardId === 'TB_BaconShop_HERO_PH') return bg;
  const playerId = numTag(hero, 'PLAYER_ID') ?? local?.playerId;
  if (playerId === undefined) return bg;
  const prevPlayer = bg.players[playerId];
  const player = playerFromHero(hero, true, prevPlayer);
  bg = {
    ...bg,
    localPlayerId: playerId,
    players: { ...bg.players, [playerId]: { ...player, playerId } },
  };
  if (prevPlayer?.heroCardId !== hero.cardId) {
    bg = push(bg, { kind: 'heroPicked', timeMs: t, cardId: hero.cardId });
  }
  return bg;
}

function updateLeaderboardHero(bg: BgGame, hero: Entity, state: GameState, t: number): BgGame {
  const playerId = numTag(hero, 'PLAYER_ID');
  if (playerId === undefined) return bg;
  const existing = bg.players[playerId];
  const localHeroId = numTag(state.entities.get(localPlayer(state)?.entityId ?? -1), 'HERO_ENTITY');
  const isLocal = hero.id === localHeroId;
  if (existing === undefined) {
    // Premier héros vu pour ce joueur avec une place : c'est son héros de classement.
    if (!isLocal && numTag(hero, 'PLAYER_LEADERBOARD_PLACE') === undefined) return bg;
  } else if (existing.heroEntityId !== hero.id) {
    // Copie de combat (ou autre entité héros) : ignorée.
    if (!isLocal) return bg;
  }
  const player = playerFromHero(hero, isLocal || (existing?.isLocal ?? false), existing);
  bg = { ...bg, players: { ...bg.players, [playerId]: player } };
  if (isLocal && bg.localPlayerId === undefined) bg = { ...bg, localPlayerId: playerId };
  // Le premier niveau (passage à 1 en début de partie) n'est pas une montée de taverne.
  if (
    existing?.techLevel !== undefined &&
    player.techLevel !== undefined &&
    player.techLevel !== existing.techLevel
  ) {
    bg = push(bg, { kind: 'techLevel', timeMs: t, playerId, level: player.techLevel });
  }
  if (
    existing !== undefined &&
    player.triples !== undefined &&
    player.triples !== existing.triples
  ) {
    bg = push(bg, { kind: 'triple', timeMs: t, playerId, total: player.triples });
  }
  return bg;
}

/**
 * Met à jour le combat en cours. Le combat est annoncé dans la chronologie dès que l'adversaire
 * est connu par son id ; le nom, qui peut arriver avant ou bien après (le renommage de
 * l'emplacement dummy est décalé dans le log), ne fait que compléter l'enregistrement.
 */
function updateCurrentCombat(
  bg: BgGame,
  patch: Partial<Pick<CombatRecord, 'opponentPlayerId' | 'opponentName'>>,
  t: number,
): BgGame {
  const last = bg.combats.at(-1);
  if (last === undefined || last.endMs !== undefined) return bg;
  let combat: CombatRecord = {
    ...last,
    opponentPlayerId: last.opponentPlayerId ?? patch.opponentPlayerId,
    opponentName: last.opponentName ?? patch.opponentName,
  };
  const opp = combat.opponentPlayerId;
  let players = bg.players;
  if (opp !== undefined && combat.opponentName !== undefined) {
    const name = combat.opponentName;
    // Garde-fou : un nom déjà porté par un autre joueur est un nom périmé, on l'écarte.
    const taken = Object.values(players).some((p) => p.playerId !== opp && p.name === name);
    const player = players[opp];
    if (taken) combat = { ...combat, opponentName: undefined };
    else if (player !== undefined && player.name !== name) {
      players = { ...players, [opp]: { ...player, name } };
    }
  }
  bg = { ...bg, players, combats: [...bg.combats.slice(0, -1), combat] };
  return opp === undefined ? bg : announceCombat(bg, t);
}

function announceCombat(bg: BgGame, t: number): BgGame {
  const last = bg.combats.at(-1);
  if (last === undefined || last.announced) return bg;
  const opp = last.opponentPlayerId;
  bg = { ...bg, combats: [...bg.combats.slice(0, -1), { ...last, announced: true }] };
  return push(bg, {
    kind: 'combatStart',
    timeMs: t,
    round: last.round,
    opponentPlayerId: opp,
    opponentName: last.opponentName,
  });
}

function endCombat(bg: BgGame, t: number): BgGame {
  const last = bg.combats.at(-1);
  if (last === undefined || last.endMs !== undefined) return bg;
  bg = announceCombat(bg, t); // adversaire jamais nommé : on annonce quand même le combat
  const places: Record<number, number> = {};
  for (const p of Object.values(bg.players))
    if (p.place !== undefined) places[p.playerId] = p.place;
  const current = bg.combats.at(-1) ?? last;
  bg = { ...bg, phase: 'recruit', combats: [...bg.combats.slice(0, -1), { ...current, endMs: t }] };
  return push(bg, {
    kind: 'combatEnd',
    timeMs: t,
    round: last.round,
    places,
    localHealth: remainingHealth(
      bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId],
    ),
  });
}

function eliminate(bg: BgGame, t: number): BgGame {
  if (bg.finalPlace !== undefined) return bg;
  const place = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId]?.place;
  if (place === undefined) return bg;
  return push(
    { ...bg, finalPlace: place, outcome: 'finished' },
    { kind: 'eliminated', timeMs: t, place },
  );
}

/**
 * Clôt une partie BG commencée qui n'a reçu aucun événement de fin : « abandonnée ou
 * interrompue », sans place finale. Sans effet sur une partie terminée ou jamais commencée.
 */
export function markInterrupted(bg: BgGame, t: number): BgGame {
  if (!bg.isBattlegrounds || bg.outcome !== 'inProgress') return bg;
  return push({ ...bg, outcome: 'interrupted', phase: 'over' }, { kind: 'interrupted', timeMs: t });
}
