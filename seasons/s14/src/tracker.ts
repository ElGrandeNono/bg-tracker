import {
  localPlayer,
  numTag,
  resolveRef,
  tagOf,
  type Entity,
  type GameState,
  type SeasonModule,
  type SeasonViewBase,
} from '@bgt/core';

/**
 * Mécaniques de la saison 14 (patch 36.2 → 37.x), lues dans les fixtures réelles du 18/10/2026
 * (voir docs/log-format.md, section « Saison 14 »). Uniquement ce que le joueur local voit.
 *
 * - Trinkets : les emplacements du joueur local sont des entités `CARDTYPE=BATTLEGROUND_TRINKET`
 *   en `PLAY` ; avant le choix, cardId `BG30_Trinket_1st` (mineur) / `BG30_Trinket_2nd`
 *   (majeur) et compte à rebours `BACON_TURNS_LEFT_TO_DISCOVER_TRINKET` ; après le choix,
 *   l'entité est transformée en trinket (`BACON_TRINKET=1`).
 * - Dark Gifts : bouton `BG36_Button_DarkGift` (`COST`, `EXHAUSTED`,
 *   `BACON_DARK_GIFT_PRESSABLE_VFX`). Chaque serviteur proposé porte `DARK_GIFT_ENTITY` = l'entité
 *   « don » (sort `BG36_MidGameEffect_000t…`) ; le serviteur choisi passe de SETASIDE à HAND.
 *   Notes du patch 36.2 : dès le tour 3, 3 or, une fois par tour, 3 fois par partie.
 * - Activation : bloc `PLAY` sur un serviteur du joueur local DÉJÀ en jeu (dépense d'or).
 * - Compteurs nommés du joueur local : `TAVERN_SPELL_ATTACK_INCREASE` / `_HEALTH_INCREASE`,
 *   `NUM_SPELLS_PLAYED_THIS_GAME`, `BACON_PLAYER_EXTRA_GOLD_NEXT_TURN`,
 *   `BACON_OLD_GOD_ATTACK` / `_HEALTH` (Divinité, C'Thun 5/3 dans la partie aux Aberrations).
 */

/** Notes du patch 36.2 : https://hearthstone.blizzard.com/en-us/news/24290432 */
export const DARK_GIFT_MAX_PER_GAME = 3;

const TRINKET_SLOTS: Readonly<Record<string, 'lesser' | 'greater'>> = {
  BG30_Trinket_1st: 'lesser',
  BG30_Trinket_2nd: 'greater',
};

export interface S14State {
  /** Serviteur proposé → entité « don » qu'il porte. */
  readonly darkGiftOffers: Readonly<Record<number, number>>;
  readonly darkGiftsTaken: readonly { readonly minionId: number; readonly giftId: number }[];
  readonly activations: readonly { readonly gameTurn: number; readonly entityId: number }[];
}

export const initialS14State: S14State = {
  darkGiftOffers: {},
  darkGiftsTaken: [],
  activations: [],
};

export type TrinketSlot =
  | {
      readonly kind: 'pending';
      readonly slot: 'lesser' | 'greater';
      readonly turnsLeft: number | undefined;
    }
  | { readonly kind: 'chosen'; readonly cardId: string };

export interface S14View extends SeasonViewBase {
  readonly seasonId: 's14';
  readonly trinkets: readonly TrinketSlot[];
  readonly darkGifts:
    | {
        readonly used: number;
        readonly max: number;
        readonly available: boolean;
        readonly cost: number | undefined;
        readonly gifts: readonly { readonly giftCardId: string; readonly minionCardId: string }[];
      }
    | undefined;
  /** Activations faites pendant le recrutement en cours (cardIds, dans l'ordre). */
  readonly activationsThisTurn: readonly string[];
  readonly activationsTotal: number;
  readonly counters: {
    readonly tavernSpellBuff: { readonly attack: number; readonly health: number } | undefined;
    readonly spellsPlayed: number | undefined;
    readonly extraGoldNextTurn: number | undefined;
    readonly oldGod: { readonly attack: number; readonly health: number } | undefined;
    /**
     * Divinité en jeu (C’Thun, Y’Shaarj…) : dbfId lu sur le sceau `BG_OldGod` du joueur local,
     * visible au-dessus du héros ; absent dans les parties sans divinité (voir `deityOf`).
     */
    readonly deityDbfId: number | undefined;
  };
}

/**
 * Divinité de la partie du joueur local. La GameEntity porte TOUJOURS un
 * `BACON_GLOBAL_OLD_GOD_DBID`, même dans les parties sans divinité : seule la présence d'une
 * entité `BG_OldGod` (le sceau au-dessus du héros) indique qu'elle est en jeu, et son
 * `BACON_EVOLUTION_CARD_ID` donne la carte (log du 20/10/2026 16:40 : 4 parties, sceaux présents
 * dans les parties 1 et 3 seulement, celles où le joueur voyait une divinité).
 */
function deityOf(game: GameState, localId: number | undefined): number | undefined {
  if (localId === undefined) return undefined;
  for (const e of game.entities.values()) {
    if (e.cardId !== 'BG_OldGod' || numTag(e, 'CONTROLLER') !== localId) continue;
    const dbf = numTag(e, 'BACON_EVOLUTION_CARD_ID');
    if (dbf !== undefined && dbf > 0) return dbf;
  }
  return undefined;
}

function localEntities(game: GameState): {
  localId: number | undefined;
  player: Entity | undefined;
} {
  const slot = localPlayer(game);
  return {
    localId: slot?.playerId,
    player: slot === undefined ? undefined : game.entities.get(slot.entityId),
  };
}

export const S14_SEASON: SeasonModule<S14State, S14View> = {
  id: 's14',
  initial: initialS14State,

  reduce(s, event, prev, next, bg) {
    if (
      event.type === 'tagChange' &&
      event.tag === 'DARK_GIFT_ENTITY' &&
      typeof event.value === 'number' &&
      event.value > 0
    ) {
      const id = resolveRef(next, event.ref);
      if (id !== undefined)
        return { ...s, darkGiftOffers: { ...s.darkGiftOffers, [id]: event.value } };
      return s;
    }
    if (event.type === 'tagChange' && event.tag === 'ZONE' && event.value === 'HAND') {
      const id = resolveRef(next, event.ref);
      const gift = id === undefined ? undefined : s.darkGiftOffers[id];
      const local = localPlayer(next)?.playerId;
      if (
        id !== undefined &&
        gift !== undefined &&
        numTag(next.entities.get(id), 'CONTROLLER') === local
      ) {
        const offers = Object.fromEntries(
          Object.entries(s.darkGiftOffers).filter(([k]) => Number(k) !== id),
        );
        return {
          ...s,
          darkGiftOffers: offers,
          darkGiftsTaken: [...s.darkGiftsTaken, { minionId: id, giftId: gift }],
        };
      }
      return s;
    }
    if (event.type === 'blockStart' && event.blockType === 'PLAY') {
      const id = resolveRef(prev, event.ref);
      const e = id === undefined ? undefined : prev.entities.get(id);
      if (
        id !== undefined &&
        tagOf(e, 'CARDTYPE') === 'MINION' &&
        tagOf(e, 'ZONE') === 'PLAY' &&
        numTag(e, 'CONTROLLER') === localPlayer(prev)?.playerId
      ) {
        return { ...s, activations: [...s.activations, { gameTurn: bg.gameTurn, entityId: id }] };
      }
    }
    return s;
  },

  view(s, bg, game) {
    const { localId, player } = localEntities(game);
    const trinkets: TrinketSlot[] = [];
    let darkButton: Entity | undefined;
    for (const e of game.entities.values()) {
      if (numTag(e, 'CONTROLLER') !== localId || tagOf(e, 'ZONE') !== 'PLAY') continue;
      if (tagOf(e, 'CARDTYPE') === 'BATTLEGROUND_TRINKET') {
        const slot = TRINKET_SLOTS[e.cardId];
        if (slot !== undefined) {
          trinkets.push({
            kind: 'pending',
            slot,
            turnsLeft: numTag(e, 'BACON_TURNS_LEFT_TO_DISCOVER_TRINKET'),
          });
        } else if (e.cardId !== '' && numTag(e, 'BACON_TRINKET') === 1) {
          trinkets.push({ kind: 'chosen', cardId: e.cardId });
        }
      } else if (
        e.cardId === 'BG36_Button_DarkGift' &&
        (darkButton === undefined || e.id > darkButton.id)
      ) {
        darkButton = e;
      }
    }

    const gameEntity =
      game.gameEntityId === undefined ? undefined : game.entities.get(game.gameEntityId);
    const darkActive = numTag(gameEntity, 'BACON_DARK_GIFTS_ACTIVE') === 1;
    const gifts = s.darkGiftsTaken.map((t) => ({
      giftCardId: game.entities.get(t.giftId)?.cardId ?? '',
      minionCardId: game.entities.get(t.minionId)?.cardId ?? '',
    }));
    const activated = s.activations.filter(
      (a) => a.gameTurn === bg.gameTurn && bg.gameTurn % 2 === 1,
    );
    const activationsThisTurn = activated
      .map((a) => game.entities.get(a.entityId)?.cardId ?? '')
      .filter((c) => c !== '');

    const atk = numTag(player, 'TAVERN_SPELL_ATTACK_INCREASE');
    const hp = numTag(player, 'TAVERN_SPELL_HEALTH_INCREASE');
    const godAtk = numTag(player, 'BACON_OLD_GOD_ATTACK');
    const godHp = numTag(player, 'BACON_OLD_GOD_HEALTH');

    const darkGifts = darkActive
      ? {
          used: s.darkGiftsTaken.length,
          max: DARK_GIFT_MAX_PER_GAME,
          available:
            darkButton !== undefined &&
            numTag(darkButton, 'BACON_DARK_GIFT_PRESSABLE_VFX') === 1 &&
            numTag(darkButton, 'EXHAUSTED') !== 1,
          cost: numTag(darkButton, 'COST'),
          gifts: gifts.filter((g) => g.giftCardId !== ''),
        }
      : undefined;

    const shownCardIds = [
      ...trinkets.flatMap((t) => (t.kind === 'chosen' ? [t.cardId] : [])),
      ...(darkGifts?.gifts.flatMap((g) => [g.giftCardId, g.minionCardId]) ?? []),
      ...activationsThisTurn,
    ].filter((c) => c !== '');

    return {
      seasonId: 's14',
      shownCardIds,
      trinkets,
      darkGifts,
      activationsThisTurn,
      activationsTotal: s.activations.length,
      counters: {
        tavernSpellBuff:
          atk !== undefined || hp !== undefined ? { attack: atk ?? 0, health: hp ?? 0 } : undefined,
        spellsPlayed: numTag(player, 'NUM_SPELLS_PLAYED_THIS_GAME'),
        extraGoldNextTurn: numTag(player, 'BACON_PLAYER_EXTRA_GOLD_NEXT_TURN'),
        oldGod:
          godAtk !== undefined && godHp !== undefined
            ? { attack: godAtk, health: godHp }
            : undefined,
        deityDbfId: deityOf(game, localId),
      },
    };
  },
};
