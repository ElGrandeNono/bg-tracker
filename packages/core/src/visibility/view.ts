import {
  remainingHealth,
  type BgGame,
  type BoardMinion,
  type Outcome,
  type Phase,
} from '../bg/bgGame.js';
import { estimateLobbyTribes, type LobbyTribes } from '../bg/tribes.js';
import { localPlayer, numTag, tagOf, type GameState } from '../state/gameState.js';

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

export type ViewWarning = 'truncated' | 'interrupted';

export interface VisibleView {
  readonly schema: typeof VIEW_SCHEMA_VERSION;
  readonly isBattlegrounds: boolean;
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

export function buildVisibleView(bg: BgGame, state: GameState): VisibleView {
  const localSlot = localPlayer(state);
  const localEntity = localSlot === undefined ? undefined : state.entities.get(localSlot.entityId);
  const local = bg.localPlayerId === undefined ? undefined : bg.players[bg.localPlayerId];
  const current = bg.combats.at(-1);
  const currentOpponent = current?.endMs === undefined ? current?.opponentPlayerId : undefined;

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
        isNextOpponent: !p.isLocal && bg.nextOpponentPlayerId === p.playerId,
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

  return {
    schema: VIEW_SCHEMA_VERSION,
    isBattlegrounds: bg.isBattlegrounds,
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
  };
}
