import type { Membership, PoolTierSummary, VisibleView } from '@bgt/core';
import type { S14View } from '@bgt/season-s14';
import type { SimSummary } from '@bgt/sim';
import type { GameEdit, GameRecord } from '@bgt/history';

/** Contrat IPC entre le processus principal et le renderer de l'overlay. */

export const CHANNELS = {
  update: 'bgt:update',
  ready: 'bgt:ready',
  saveLayout: 'bgt:save-layout',
  rendered: 'bgt:rendered',
  catalog: 'bgt:catalog',
  openBrowser: 'bgt:open-browser',
  openDashboard: 'bgt:open-dashboard',
  historyList: 'bgt:history-list',
  historyGet: 'bgt:history-get',
  historyUpdate: 'bgt:history-update',
  historyExport: 'bgt:history-export',
  historyImport: 'bgt:history-import',
  historyChanged: 'bgt:history-changed',
  historyProgress: 'bgt:history-progress',
} as const;

/** Liste de l'historique et noms des cartes citées (cardId → nom localisé). */
export interface HistoryListing {
  readonly games: readonly GameRecord[];
  readonly names: Readonly<Record<string, string>>;
}

export interface HistoryGame {
  readonly game: GameRecord;
  readonly names: Readonly<Record<string, string>>;
}

/** Avancement de l'import des anciens logs. */
export interface ImportProgress {
  readonly done: number;
  readonly total: number;
  readonly added: number;
  readonly current: string | undefined;
}

/** API de l'historique exposée au tableau de bord. */
export interface HistoryBridge {
  list(): Promise<HistoryListing>;
  get(id: number): Promise<HistoryGame | undefined>;
  update(id: number, edit: GameEdit): Promise<void>;
  /** Ouvre une boîte « Enregistrer sous » ; renvoie le chemin écrit ou undefined (annulé). */
  exportGames(format: 'csv' | 'json'): Promise<string | undefined>;
  /** Importe les parties BG des anciens dossiers Logs du jeu ; renvoie le nombre ajouté. */
  importLogs(): Promise<number>;
  onChanged(listener: () => void): () => void;
  onImportProgress(listener: (p: ImportProgress) => void): () => void;
}

export type HsWindowState = 'notFound' | 'ok' | 'minimized' | 'background' | 'fullscreen';

export interface OverlayStatus {
  readonly source: 'live' | 'replay';
  /** Problèmes détectés dans log.config / client.config (vide si tout va bien). */
  readonly configProblems: readonly string[];
  readonly hsWindow: HsWindowState;
  readonly cardData: 'loading' | 'ok' | 'stale' | 'error';
  readonly replayDone: boolean;
}

export interface PanelPosition {
  /** Position en fraction de la fenêtre (0-1), pour suivre les redimensionnements du jeu. */
  readonly x: number;
  readonly y: number;
}

export interface OverlaySettings {
  readonly opacity: number;
  readonly compact: boolean;
  readonly theme: 'dark' | 'light';
  /** Verrouillé = click-through ; déverrouillé = panneaux déplaçables. */
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly scale: number;
  readonly panels: Readonly<Record<'bar' | 'lobby', PanelPosition>>;
  /** Fond sombre de démonstration (captures, mode autonome) : jamais en jeu. */
  readonly backdrop: boolean;
}

export const DEFAULT_SETTINGS: OverlaySettings = {
  opacity: 0.92,
  compact: false,
  theme: 'dark',
  locked: true,
  hidden: false,
  scale: 1,
  panels: { bar: { x: 0.36, y: 0.012 }, lobby: { x: 0.8, y: 0.16 } },
  backdrop: false,
};

export interface OverlayPayload {
  readonly view: VisibleView<S14View>;
  /** Noms localisés des cartes présentes dans la vue (cardId → nom). */
  readonly names: Readonly<Record<string, string>>;
  readonly status: OverlayStatus;
  readonly settings: OverlaySettings;
  /** Fin estimée du recrutement en cours (horloge locale, ms) ; absent si inconnue. */
  readonly timerEndsAt: number | undefined;
  /** Pool estimé à partir de ce que le joueur a vu ; absent tant que les données manquent. */
  readonly pool: PoolPayload | undefined;
  /** Simulation du combat en cours ou à venir (plateaux affichés uniquement). */
  readonly combatSim: CombatSimPayload | undefined;
}

export interface CombatSimPayload {
  /** `combat` : plateaux du combat en cours ; `nextOpponent` : dernier plateau vu du prochain adversaire. */
  readonly context: 'combat' | 'nextOpponent';
  readonly opponentPlayerId: number;
  readonly boardRound: number;
  readonly summary: SimSummary;
  /** Faux tant que les 10 000 simulations ne sont pas toutes faites (résultat qui s'affine). */
  readonly final: boolean;
}

export interface PoolPayload {
  readonly tiers: readonly PoolTierSummary[];
  readonly byTribe: Readonly<Record<string, number>>;
  readonly lobbyComplete: boolean;
  /** Règles dont les sources divergent (affichées comme incertaines). */
  readonly unverifiedRules: readonly string[];
  /** Par carte : exemplaires restants, appartenance, probabilité à la prochaine actualisation. */
  readonly cards: Readonly<
    Record<string, { remaining: number; membership: Membership; probability: number }>
  >;
}

/** Fiche statique d'un serviteur du pool (envoyée une fois par build, pour le navigateur). */
export interface CatalogCard {
  readonly id: string;
  readonly name: string;
  readonly tier: number;
  readonly tribes: readonly string[];
  readonly allTribes: boolean;
  readonly attack: number | undefined;
  readonly health: number | undefined;
  readonly mechanics: readonly string[];
  /** Texte brut (balises retirées). */
  readonly text: string;
  readonly copies: number;
}

/** API exposée au renderer par le preload (`window.bgt`). */
export interface BgtBridge {
  onUpdate(listener: (payload: OverlayPayload) => void): () => void;
  ready(): void;
  saveLayout(panels: OverlaySettings['panels']): void;
  rendered(): void;
  /** Fiches du pool, à chaque changement de build. */
  onCatalog(listener: (cards: readonly CatalogCard[]) => void): () => void;
  openBrowser(): void;
  openDashboard(): void;
  readonly history: HistoryBridge;
}
