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
  openSettings: 'bgt:open-settings',
  updateSettings: 'bgt:update-settings',
  setInteractive: 'bgt:set-interactive',
  tribeArt: 'bgt:tribe-art',
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

export type PanelId = 'status' | 'players' | 'sim' | 'counters';

export type Theme = 'dark' | 'light' | 'contrast';
export type Language = 'fr' | 'en';

/** Sections de l'overlay que l'on peut masquer individuellement. */
export interface SectionVisibility {
  readonly bar: boolean;
  readonly lobby: boolean;
  readonly tribes: boolean;
  readonly pool: boolean;
  readonly season: boolean;
  readonly simulation: boolean;
  readonly opponentBoard: boolean;
  /** Rafraîchissements gratuits, gemmes de sang, sorts et serviteurs de la taverne. */
  readonly counters: boolean;
}

export interface AlertSettings {
  readonly sound: boolean;
  readonly turnStart: boolean;
  /** Moins de 10 s de recrutement. */
  readonly timerLow: boolean;
  /** Un triple est réalisable : deux exemplaires (main + plateau) et le troisième en boutique. */
  readonly triple: boolean;
  /** Toutes les tribus du lobby viennent d'être identifiées. */
  readonly tribesFound: boolean;
}

export interface StreamerSettings {
  /** Serveur local pour OBS (127.0.0.1 uniquement) : désactivé par défaut. */
  readonly enabled: boolean;
  readonly port: number;
  readonly hideOpponentNames: boolean;
  readonly hideSimulation: boolean;
  readonly hidePool: boolean;
}

export interface OverlaySettings {
  readonly opacity: number;
  readonly compact: boolean;
  readonly theme: Theme;
  readonly language: Language;
  readonly sections: SectionVisibility;
  readonly alerts: AlertSettings;
  readonly streamer: StreamerSettings;
  /** Vérification des mises à jour sur GitHub : désactivée par défaut (accès réseau). */
  readonly autoUpdate: boolean;
  /** Verrouillé = click-through ; déverrouillé = panneaux déplaçables. */
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly scale: number;
  /**
   * Panneaux déplaçables : état (tour, or, boutons) en haut à droite, joueurs à gauche,
   * simulation en haut au milieu, compteurs à droite du pouvoir héroïque.
   */
  readonly panels: Readonly<Record<PanelId, PanelPosition>>;
  /** Fond sombre de démonstration (captures, mode autonome) : jamais en jeu. */
  readonly backdrop: boolean;
}

export const DEFAULT_SETTINGS: OverlaySettings = {
  opacity: 0.92,
  compact: false,
  theme: 'dark',
  language: 'fr',
  sections: {
    bar: true,
    lobby: true,
    tribes: true,
    pool: true,
    season: true,
    simulation: true,
    opponentBoard: true,
    counters: true,
  },
  alerts: { sound: false, turnStart: false, timerLow: true, triple: true, tribesFound: false },
  streamer: {
    enabled: false,
    port: 5280,
    hideOpponentNames: true,
    hideSimulation: false,
    hidePool: false,
  },
  autoUpdate: false,
  locked: true,
  hidden: false,
  scale: 1,
  panels: {
    status: { x: 0.72, y: 0.008 },
    players: { x: 0.004, y: 0.1 },
    sim: { x: 0.4, y: 0.008 },
    counters: { x: 0.63, y: 0.8 },
  },
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
  /**
   * Bonus des serviteurs de la boutique affichée, par tribu (`ALL` = tous) : écart entre leurs
   * stats et celles de la carte (HearthstoneJSON). Aucun tag du log ne les donne directement.
   */
  readonly tavernBuffs: readonly TavernBuff[];
}

export interface TavernBuff {
  readonly tribe: string;
  readonly attack: number;
  readonly health: number;
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
  readonly unverifiedRules: readonly UnverifiedRule[];
  /** Par carte : exemplaires restants, appartenance, probabilité à la prochaine actualisation. */
  readonly cards: Readonly<
    Record<string, { remaining: number; membership: Membership; probability: number }>
  >;
}

export type UnverifiedRule =
  | { readonly kind: 'copies'; readonly tier: number; readonly copies: number }
  | { readonly kind: 'eliminatedReturn' };

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

export type SettingsPatch = Partial<
  Omit<OverlaySettings, 'sections' | 'alerts' | 'streamer' | 'panels' | 'backdrop' | 'locked'>
> & {
  readonly sections?: Partial<SectionVisibility>;
  readonly alerts?: Partial<AlertSettings>;
  readonly streamer?: Partial<StreamerSettings>;
  readonly resetPanels?: boolean;
};

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
  openSettings(): void;
  /** Fusionne des réglages (fenêtre Réglages) ; le résultat revient via onUpdate. */
  updateSettings(patch: SettingsPatch): void;
  /**
   * Overlay click-through : la souris survole un bouton de l'overlay, il doit recevoir le clic
   * (vrai) ou redevenir transparent aux clics (faux).
   */
  setInteractive(on: boolean): void;
  /** Image (data URL, HearthstoneJSON, en cache local) d'un serviteur représentatif par tribu. */
  onTribeArt(listener: (art: Readonly<Record<string, string>>) => void): () => void;
  readonly history: HistoryBridge;
}
