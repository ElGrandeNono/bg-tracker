/**
 * Données de cartes HearthstoneJSON (https://hearthstonejson.com/), réduites à ce qui sert à
 * Battlegrounds. Champs vérifiés le 18/10/2026 sur `/v1/254477/frFR/cards.json` (36 390 cartes) :
 * `id`, `dbfId`, `name`, `type`, `techLevel`, `races`, `battlegroundsHero`,
 * `battlegroundsSkinParentId` (dbfId du héros de base d'un skin), `heroPowerDbfId`,
 * `isBattlegroundsPoolMinion`, `battlegroundsPremiumDbfId` / `battlegroundsNormalDbfId`
 * (versions dorée / normale), `isBattlegroundsDarkGift`.
 * Aucun asset n'est embarqué : tout est téléchargé au runtime puis mis en cache.
 */

export interface CardInfo {
  readonly id: string;
  readonly dbfId: number;
  readonly name: string;
  readonly type: string | undefined;
  readonly techLevel: number | undefined;
  readonly races: readonly string[];
  readonly battlegroundsHero: boolean;
  readonly battlegroundsSkinParentId: number | undefined;
  readonly heroPowerDbfId: number | undefined;
  readonly isBattlegroundsPoolMinion: boolean;
  readonly battlegroundsPremiumDbfId: number | undefined;
  readonly battlegroundsNormalDbfId: number | undefined;
  readonly isBattlegroundsDarkGift: boolean;
  readonly isBattlegroundsDuosExclusive: boolean;
  /** Neutre rattaché à une tribu : présent dans le pool seulement si elle est dans le lobby. */
  readonly battlegroundsAssociatedRaces: readonly string[];
  readonly attack: number | undefined;
  readonly health: number | undefined;
  /** Mots-clés HearthstoneJSON (`TAUNT`, `DIVINE_SHIELD`, `DEATHRATTLE`, `BACON_RALLY`…). */
  readonly mechanics: readonly string[];
  /** Texte de la carte (balises `<b>`, `<i>` et `[x]` éventuelles), à afficher en texte brut. */
  readonly text: string;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Normalise une entrée brute ; `undefined` si elle n'a pas la forme attendue. */
export function toCardInfo(raw: Raw): CardInfo | undefined {
  const id = str(raw.id);
  const dbfId = num(raw.dbfId);
  if (id === undefined || dbfId === undefined) return undefined;
  const races = Array.isArray(raw.races)
    ? raw.races.filter((r): r is string => typeof r === 'string')
    : str(raw.race) !== undefined
      ? [str(raw.race) ?? '']
      : [];
  return {
    id,
    dbfId,
    name: str(raw.name) ?? id,
    type: str(raw.type),
    techLevel: num(raw.techLevel),
    races,
    battlegroundsHero: raw.battlegroundsHero === true,
    battlegroundsSkinParentId: num(raw.battlegroundsSkinParentId),
    heroPowerDbfId: num(raw.heroPowerDbfId),
    isBattlegroundsPoolMinion: raw.isBattlegroundsPoolMinion === true,
    battlegroundsPremiumDbfId: num(raw.battlegroundsPremiumDbfId),
    battlegroundsNormalDbfId: num(raw.battlegroundsNormalDbfId),
    isBattlegroundsDarkGift: raw.isBattlegroundsDarkGift === true,
    isBattlegroundsDuosExclusive: raw.isBattlegroundsDuosExclusive === true,
    battlegroundsAssociatedRaces: strings(raw.battlegroundsAssociatedRaces),
    attack: num(raw.attack),
    health: num(raw.health),
    mechanics: strings(raw.mechanics),
    text: str(raw.text) ?? '',
  };
}

/** Cartes utiles à BG : set BATTLEGROUNDS, héros, serviteurs du pool, cartes à niveau de taverne. */
export function isBattlegroundsRelevant(raw: Raw): boolean {
  return (
    raw.set === 'BATTLEGROUNDS' ||
    raw.battlegroundsHero === true ||
    raw.isBattlegroundsPoolMinion === true ||
    typeof raw.techLevel === 'number' ||
    typeof raw.battlegroundsSkinParentId === 'number'
  );
}

export class CardDb {
  private readonly byIdMap = new Map<string, CardInfo>();
  private readonly byDbf = new Map<number, CardInfo>();

  constructor(cards: Iterable<CardInfo>) {
    for (const c of cards) {
      this.byIdMap.set(c.id, c);
      this.byDbf.set(c.dbfId, c);
    }
  }

  static fromRaw(raw: unknown): CardDb {
    if (!Array.isArray(raw)) throw new Error('cards.json : un tableau était attendu');
    const cards: CardInfo[] = [];
    for (const r of raw as unknown[]) {
      if (typeof r !== 'object' || r === null) continue;
      const c = toCardInfo(r as Raw);
      if (c !== undefined) cards.push(c);
    }
    return new CardDb(cards);
  }

  get size(): number {
    return this.byIdMap.size;
  }

  byId(id: string): CardInfo | undefined {
    return this.byIdMap.get(id);
  }

  byDbfId(dbfId: number): CardInfo | undefined {
    return this.byDbf.get(dbfId);
  }

  /** Nom localisé, ou le cardId si la carte est inconnue (jamais d'exception). */
  name(id: string): string {
    return this.byIdMap.get(id)?.name ?? id;
  }

  /** Skin de héros → héros de base, via `battlegroundsSkinParentId`. */
  baseHero(id: string): CardInfo | undefined {
    const card = this.byIdMap.get(id);
    if (card?.battlegroundsSkinParentId === undefined) return card;
    return this.byDbf.get(card.battlegroundsSkinParentId) ?? card;
  }

  /** Version normale d'un serviteur doré, via `battlegroundsNormalDbfId`. */
  normalVersion(id: string): CardInfo | undefined {
    const card = this.byIdMap.get(id);
    if (card?.battlegroundsNormalDbfId === undefined) return card;
    return this.byDbf.get(card.battlegroundsNormalDbfId) ?? card;
  }

  toJSON(): CardInfo[] {
    return [...this.byIdMap.values()];
  }
}
