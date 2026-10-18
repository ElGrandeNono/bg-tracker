import {
  remainingHealth,
  type BgGame,
  type BoardMinion,
  type GameMode,
  type Outcome,
  type Phase,
} from '../bg/bgGame.js';
import { estimateLobbyTribes, type LobbyTribes } from '../bg/tribes.js';
import type { PoolSighting } from '../pool/pool.js';
import type { SeasonViewBase } from '../season/module.js';
import {
  dummyPlayer,
  localPlayer,
  numTag,
  tagOf,
  type Entity,
  type GameState,
} from '../state/gameState.js';

/**
 * FILTRE FAIR-PLAY : seul chemin entre l'état de jeu et l'UI (overlay, dashboard, stream,
 * plugins). `GameState` contient des informations qu'un joueur ne voit pas (mains, entités
 * cachées, boutiques…) ; cette fonction construit une vue par LISTE BLANCHE, champ par champ,
 * de ce qui est visible en jouant normalement :
 *
 * - classement : héros, place, niveau de taverne, triples, PV/armure des 8 joueurs ;
 * - le joueur local : or, coût d'amélioration, minuteur du tour, niveau de taverne ;
 * - adversaires affrontés et plateaux vus au début de chaque combat (affichés à l'écran) ;
 * - prochain adversaire (mis en évidence par le jeu) ;
 * - tribus déduites des seuls serviteurs visibles (voir bg/tribes.ts).
 *
 * Aucun identifiant d'entité, aucune main, aucune boutique adverse, aucune carte non révélée.
 * Test : visibility/view.test.ts rejoue les fixtures réelles et le vérifie.
 */

export const VIEW_SCHEMA_VERSION = 1;

export interface VisibleMinion {
  readonly cardId: string;
  readonly attack: number | undefined;
  readonly health: number | undefined;
  readonly golden: boolean;
  readonly keywords: readonly Keyword[];
}

export type Keyword =
  'TAUNT' | 'DIVINE_SHIELD' | 'REBORN' | 'VENOMOUS' | 'WINDFURY' | 'DEATHRATTLE' | 'STEALTH';

const KEYWORDS: readonly Keyword[] = [
  'TAUNT',
  'DIVINE_SHIELD',
  'REBORN',
  'VENOMOUS',
  'WINDFURY',
  'DEATHRATTLE',
  'STEALTH',
];

export interface VisibleBoard {
  readonly round: number;
  readonly minions: readonly VisibleMinion[];
}

export interface VisiblePlayer {
  readonly playerId: number;
  readonly isLocal: boolean;
  readonly heroCardId: string;
  readonly name: string | undefined;
  readonly place: number | undefined;
  readonly techLevel: number | undefined;
  readonly triples: number | undefined;
  readonly health: number | undefined;
  readonly armor: number | undefined;
  readonly isNextOpponent: boolean;
  readonly isCurrentOpponent: boolean;
  /** Nombre de combats déjà joués contre ce joueur. */
  readonly timesFaced: number;
  /** Dernier plateau vu au début d'un combat contre ce joueur. */
  readonly lastBoard: VisibleBoard | undefined;
}

export interface VisibleLocal {
  readonly playerId: number | undefined;
  readonly heroCardId: string | undefined;
  readonly techLevel: number | undefined;
  readonly upgradeCost: number | undefined;
  /** `RESOURCES - RESOURCES_USED` sur le joueur local (vérifié sur F2 : 3, 4, 5… par tour). */
  readonly gold: number | undefined;
  readonly maxGold: number | undefined;
  readonly triples: number | undefined;
  readonly health: number | undefined;
  readonly armor: number | undefined;
  /** Durée du recrutement en cours, en secondes (`TIMEOUT` sur le joueur local). */
  readonly turnTimeoutSec: number | undefined;
}

export type ViewWarning = 'truncated' | 'interrupted' | 'abandoned';

export interface VisibleView<V extends SeasonViewBase = SeasonViewBase> {
  readonly schema: typeof VIEW_SCHEMA_VERSION;
  readonly isBattlegrounds: boolean;
  /** Seul `solo` est pris en charge ; l'UI n'affiche qu'un avertissement sinon. */
  readonly mode: GameMode;
  readonly build: string | undefined;
  readonly phase: Phase;
  readonly outcome: Outcome;
  readonly round: number;
  readonly finalPlace: number | undefined;
  readonly local: VisibleLocal;
  /** Triés par place (inconnue en dernier). */
  readonly players: readonly VisiblePlayer[];
  readonly tribes: LobbyTribes;
  readonly warnings: readonly ViewWarning[];
  /**
   * Serviteurs VUS hors du pool partagé : main et plateau du joueur local, boutique de Bob
   * (recrutement), derniers plateaux adverses vus en combat. Base du pool tracker.
   */
  readonly poolSightings: readonly PoolSighting[];
  /**
   * Plateau du joueur local tel qu'affiché : en recrutement, ses serviteurs en jeu (gauche → droite) ;
   * en combat, le plateau figé au début du combat.
   */
  readonly localBoard: readonly VisibleMinion[];
  /** Combat en cours dont les plateaux sont connus (affichés à l'écran). */
  readonly currentCombat:
    | {
        readonly round: number;
        readonly opponentPlayerId: number | undefined;
        readonly localBoard: readonly VisibleMinion[];
        readonly opponentBoard: readonly VisibleMinion[];
      }
    | undefined;
  /** Plafond de dégâts du combat (`BACON_COMBAT_DAMAGE_CAP` si `_ENABLED=1`), sinon absent. */
  readonly damageCap: number | undefined;
  /** Vue du module de saison (trinkets, dons, compteurs…), construite par lui seul. */
  readonly season: V | undefined;
}

function toVisibleMinion(m: BoardMinion): VisibleMinion {
  return {
    cardId: m.cardId,
    attack: m.attack,
    health: m.health,
    golden: m.golden,
    keywords: KEYWORDS.filter((k) => m.tags[k] === 1),
  };
}

/** Bouton d'amélioration de taverne du joueur local (`TB_BaconShopTechUp0N_Button`, en PLAY). */
function upgradeCost(state: GameState, localId: number | undefined): number | undefined {
  if (localId === undefined) return undefined;
  let best: { id: number; cost: number } | undefined;
  for (const e of state.entities.values()) {
    if (!e.cardId.startsWith('TB_BaconShopTechUp')) continue;
    if (numTag(e, 'CONTROLLER') !== localId || tagOf(e, 'ZONE') !== 'PLAY') continue;
    const cost = numTag(e, 'COST');
    if (cost !== undefined && (best === undefined || e.id > best.id)) best = { id: e.id, cost };
  }
  return best?.cost;
}

/** Serviteurs du joueur local en jeu (recrutement) ou plateau figé du combat en cours. */
function localBoard(bg: BgGame, state: GameState): VisibleMinion[] {
  const last = bg.combats.at(-1);
  if (last !== undefined && last.endMs === undefined) return last.localBoard.map(toVisibleMinion);
  const localId = localPlayer(state)?.playerId;
  const out: { pos: number; m: VisibleMinion }[] = [];
  for (const e of state.entities.values()) {
    if (e.cardId === '' || tagOf(e, 'CARDTYPE') !== 'MINION') continue;
    if (numTag(e, 'CONTROLLER') !== localId || tagOf(e, 'ZONE') !== 'PLAY') continue;
    const health = numTag(e, 'HEALTH');
    out.push({
      pos: numTag(e, 'ZONE_POSITION') ?? 0,
      m: {
        cardId: e.cardId,
        attack: numTag(e, 'ATK'),
        health: health === undefined ? undefined : health - (numTag(e, 'DAMAGE') ?? 0),
        golden: isGolden(e),
        keywords: KEYWORDS.filter((k) => e.tags[k] === 1),
      },
    });
  }
  return out.sort((a, b) => a.pos - b.pos).map((x) => x.m);
}

function damageCap(state: GameState): number | undefined {
  const g = state.gameEntityId === undefined ? undefined : state.entities.get(state.gameEntityId);
  return numTag(g, 'BACON_COMBAT_DAMAGE_CAP_ENABLED') === 1
    ? numTag(g, 'BACON_COMBAT_DAMAGE_CAP')
    : undefined;
}

const isGolden = (e: Entity): boolean => numTag(e, 'PREMIUM') === 1 || e.cardId.endsWith('_G');

/**
 * Exemplaires retirés du pool que le joueur a VUS. Hors combat : ses serviteurs en main et en jeu,
 * et la boutique (serviteurs du dummy en jeu pendant le recrutement). En combat : le plateau local
 * figé au début du combat et la main ; la boutique n'est pas visible. Adversaires : le dernier
 * plateau vu de chacun, avec l'indication « éliminé » (le pool tracker décide selon la règle).
 */
function poolSightings(
  bg: BgGame,
  state: GameState,
  players: readonly VisiblePlayer[],
): PoolSighting[] {
  const out: PoolSighting[] = [];
  const localId = localPlayer(state)?.playerId;
  const dummyId = dummyPlayer(state)?.playerId;
  const last = bg.combats.at(-1);
  const inCombat = last !== undefined && last.endMs === undefined;
  for (const e of state.entities.values()) {
    if (e.cardId === '' || tagOf(e, 'CARDTYPE') !== 'MINION') continue;
    const controller = numTag(e, 'CONTROLLER');
    const zone = tagOf(e, 'ZONE');
    if (controller === localId && (zone === 'HAND' || (zone === 'PLAY' && !inCombat))) {
      out.push({ cardId: e.cardId, golden: isGolden(e), source: 'local' });
    } else if (!inCombat && controller === dummyId && zone === 'PLAY') {
      out.push({ cardId: e.cardId, golden: isGolden(e), source: 'shop' });
    }
  }
  if (inCombat) {
    for (const m of last.localBoard)
      out.push({ cardId: m.cardId, golden: m.golden, source: 'local' });
  }
  for (const p of players) {
    if (p.isLocal) continue;
    const eliminated = p.health !== undefined && p.health <= 0;
    for (const m of p.lastBoard?.minions ?? []) {
      out.push({
        cardId: m.cardId,
        golden: m.golden,
        source: 'opponent',
        ownerEliminated: eliminated,
      });
    }
  }
  return out;
}

export function buildVisibleView<V extends SeasonViewBase = SeasonViewBase>(
  bg: BgGame,
  state: GameState,
  season?: V,
): VisibleView<V> {
  const localSlot = localPlayer(state);
  const localEntity = localSlot === undefined ? undefined : state.entities.get(localSlot.entityId);
  const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
  const current = bg.combats.at(-1);
  // Partie close : plus d’dversaire « en cours » ni de « prochain » (le combat fatal ne se clôt pas).
  const live = bg.outcome === 'inProgress';
  const currentOpponent =
    live && current?.endMs === undefined ? current?.opponentPlayerId : undefined;

  const resources = numTag(localEntity, 'RESOURCES');
  const used = numTag(localEntity, 'RESOURCES_USED') ?? 0;

  const players = Object.values(bg.players)
    .map((p): VisiblePlayer => {
      const faced = bg.combats.filter((c) => c.opponentPlayerId === p.playerId);
      const withBoard = faced.filter((c) => c.boardsLocked && c.opponentBoard.length > 0).at(-1);
      return {
        playerId: p.playerId,
        isLocal: p.isLocal,
        heroCardId: p.heroCardId,
        name: p.name,
        place: p.place,
        techLevel: p.techLevel,
        triples: p.triples,
        health: remainingHealth(p),
        armor: p.armor,
        isNextOpponent: live && !p.isLocal && bg.nextOpponentPlayerId === p.playerId,
        isCurrentOpponent: !p.isLocal && currentOpponent === p.playerId,
        timesFaced: faced.filter((c) => c.endMs !== undefined).length,
        lastBoard:
          withBoard === undefined
            ? undefined
            : { round: withBoard.round, minions: withBoard.opponentBoard.map(toVisibleMinion) },
      };
    })
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || a.playerId - b.playerId);

  const warnings: ViewWarning[] = [];
  if (bg.truncated) warnings.push('truncated');
  if (bg.outcome === 'interrupted') warnings.push('interrupted');
  if (bg.outcome === 'abandoned') warnings.push('abandoned');

  return {
    schema: VIEW_SCHEMA_VERSION,
    isBattlegrounds: bg.isBattlegrounds,
    mode: bg.mode,
    build: bg.build,
    phase: bg.phase,
    outcome: bg.outcome,
    round: bg.round,
    finalPlace: bg.finalPlace,
    local: {
      playerId: bg.localPlayerId,
      heroCardId: local?.heroCardId,
      techLevel: local?.techLevel,
      upgradeCost: upgradeCost(state, localSlot?.playerId),
      gold: resources === undefined ? undefined : Math.max(0, resources - used),
      maxGold: resources,
      triples: local?.triples,
      health: remainingHealth(local),
      armor: local?.armor,
      turnTimeoutSec: numTag(localEntity, 'TIMEOUT'),
    },
    players,
    tribes: estimateLobbyTribes(bg.tribes),
    warnings,
    poolSightings: poolSightings(bg, state, players),
    localBoard: localBoard(bg, state),
    currentCombat:
      current !== undefined && current.endMs === undefined && current.boardsLocked && live
        ? {
            round: current.round,
            opponentPlayerId: current.opponentPlayerId,
            localBoard: current.localBoard.map(toVisibleMinion),
            opponentBoard: current.opponentBoard.map(toVisibleMinion),
          }
        : undefined,
    damageCap: damageCap(state),
    season,
  };
}
