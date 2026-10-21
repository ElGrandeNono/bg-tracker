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
  setLobbyTribes: 'bgt:set-lobby-tribes',
  checkUpdates: 'bgt:check-updates',
  importStats: 'bgt:import-stats',
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
  /**
   * Suivi en direct sans nouvelle ligne de log depuis 3 min alors que la partie semble en cours
   * (abandon : le jeu n'écrit plus rien) : l'overlay revient à l'état d'attente.
   */
  readonly stale: boolean;
}

export interface PanelPosition {
  /** Position en fraction de la fenêtre (0-1), pour suivre les redimensionnements du jeu. */
  readonly x: number;
  readonly y: number;
}

export type PanelId = 'status' | 'players' | 'sim' | 'counters' | 'choice';

export type Theme = 'dark' | 'light' | 'contrast';
export type Language = 'fr' | 'en';

/** Sections de l'overlay que l'on peut masquer individuellement. */
export interface SectionVisibility {
  readonly bar: boolean;
  readonly lobby: boolean;
  readonly tribes: boolean;
  /** Ligne « Pool par niveau » (désactivée par défaut ; nouvelle clé en 0.8.2). */
  readonly poolByTier: boolean;
  readonly season: boolean;
  readonly simulation: boolean;
  readonly opponentBoard: boolean;
  /** Rafraîchissements gratuits, gemmes de sang, sorts et serviteurs de la taverne. */
  readonly counters: boolean;
  /** Stats des héros / bibelots proposés (stats externes collées par le joueur). */
  readonly choiceStats: boolean;
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
  /** Heure locale dans le panneau d'état (désactivée par défaut). */
  readonly showClock: boolean;
  /** Résultat de la simulation masqué tant qu'on ne clique pas dessus. */
  readonly simOnClick: boolean;
  /**
   * Lecture des tribus de la partie à l'écran (capture de la fenêtre du jeu + OCR local, pendant
   * le choix du héros) : désactivée par défaut.
   */
  readonly screenReading: boolean;
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
    poolByTier: false,
    season: true,
    simulation: true,
    opponentBoard: true,
    counters: true,
    choiceStats: true,
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
  showClock: false,
  simOnClick: false,
  screenReading: false,
  locked: true,
  hidden: false,
  scale: 1,
  panels: {
    status: { x: 0.72, y: 0.008 },
    players: { x: 0.004, y: 0.1 },
    sim: { x: 0.4, y: 0.008 },
    counters: { x: 0.63, y: 0.8 },
    choice: { x: 0.33, y: 0.7 },
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
  /** Tribus du lobby cochées par le joueur (elles remplacent la déduction) ; sinon absent. */
  readonly manualTribes: readonly string[] | undefined;
  /** Divinité de la partie (cardId HearthstoneJSON), si connue. */
  readonly deityCardId: string | undefined;
  /** Stats des options du choix en cours (héros, bibelots), d'après les stats externes. */
  readonly choiceStats: ChoiceStatsPayload | undefined;
  /** Stats externes enregistrées (Réglages › Stats externes). */
  readonly externalStats: ExternalStatsSummary;
  /** Version de l'application installée (package.json). */
  readonly appVersion: string;
  /** Dernière vérification des mises à jour (Réglages › Mises à jour). */
  readonly updateStatus: UpdateStatus;
}

/** Stats d'une option (copie HSReplay) : taux de choix, place moyenne si fournie, répartition. */
export interface OptionStats {
  readonly pickRate: number;
  readonly avgPlacement: number | undefined;
  readonly distribution: readonly number[] | undefined;
  /** Moyenne de N variantes de tribu (bibelot dont la tribu est tirée en partie) ; sinon absent. */
  readonly variants: number | undefined;
}

export interface ChoiceStatsPayload {
  readonly kind: 'hero' | 'trinket';
  /** Dans l'ordre affiché par le jeu (gauche → droite). */
  readonly options: readonly { readonly cardId: string; readonly stats: OptionStats | undefined }[];
}

export type ExternalStatsSummary = Readonly<
  Record<
    'heroes-solo' | 'heroes-duos' | 'trinkets',
    { readonly updatedAt: string; readonly count: number } | undefined
  >
>;

export interface ImportStatsResult {
  readonly page: 'heroes-solo' | 'heroes-duos' | 'trinkets' | undefined;
  readonly matched: number;
  readonly unmatched: readonly string[];
  /** `unrecognized` : le presse-papiers ne contient pas une page HSReplay connue. */
  readonly error: 'unrecognized' | 'noCards' | undefined;
}

export type UpdateStatus =
  | { readonly state: 'idle' | 'devBuild' | 'checking' | 'upToDate' | 'noRelease' | 'error' }
  | { readonly state: 'available' | 'downloading' | 'ready'; readonly version: string };

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
  /**
   * Tribus du lobby cochées par le joueur pour la partie `gameIndex` (le jeu les affiche, le log
   * ne les contient pas) ; liste vide = revenir à la déduction.
   */
  setLobbyTribes(gameIndex: number, tribes: readonly string[]): void;
  /** Vérifie maintenant les mises à jour (bouton des Réglages ; accès réseau à GitHub). */
  checkUpdates(): void;
  /** Lit une page HSReplay copiée par le joueur (presse-papiers) et enregistre ses stats. */
  importStatsFromClipboard(): Promise<ImportStatsResult>;
  /**
   * Images (data URL, HearthstoneJSON, en cache local) : clé = tribe (serviteur représentatif)
   * ou `card:<cardId>` (divinité).
   */
  onTribeArt(listener: (art: Readonly<Record<string, string>>) => void): () => void;
  readonly history: HistoryBridge;
}
