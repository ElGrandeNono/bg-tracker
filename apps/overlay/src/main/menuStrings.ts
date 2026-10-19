import type { Language } from '../shared/payload.js';

/** Textes du processus principal (tray, titres de fenêtres, boîtes de dialogue), fr / en. */

const fr = {
  disclaimer: 'BG Tracker — non affilié à Blizzard Entertainment',
  toggle: 'Afficher / masquer',
  unlock: 'Déverrouiller / verrouiller (déplacer)',
  opacity: 'Opacité',
  compact: 'Mode compact',
  browser: 'Navigateur de serviteurs',
  dashboard: 'Historique et statistiques',
  settings: 'Réglages',
  quit: 'Quitter',
  titleBrowser: 'BG Tracker — serviteurs',
  titleDashboard: 'BG Tracker — historique',
  titleSettings: 'BG Tracker — réglages',
  streamError: (port: number) =>
    `Mode streamer : le port ${port} est déjà utilisé. Choisissez-en un autre dans les Réglages.`,
  shortcutsTaken: (keys: string) =>
    `Raccourcis déjà utilisés par une autre application : ${keys}. Utilisez le menu de l’icône BG Tracker.`,
  updateAvailable: (v: string) => `La version ${v} de BG Tracker est disponible.`,
  updateDetail: 'Télécharger et installer maintenant ? (fichier publié sur GitHub)',
  updateReady: 'La mise à jour est prête. Redémarrer BG Tracker pour l’installer ?',
  yes: 'Oui',
  later: 'Plus tard',
};

type MenuStrings = typeof fr;

const en: MenuStrings = {
  disclaimer: 'BG Tracker — not affiliated with Blizzard Entertainment',
  toggle: 'Show / hide',
  unlock: 'Unlock / lock (move)',
  opacity: 'Opacity',
  compact: 'Compact mode',
  browser: 'Minion browser',
  dashboard: 'History and statistics',
  settings: 'Settings',
  quit: 'Quit',
  titleBrowser: 'BG Tracker — minions',
  titleDashboard: 'BG Tracker — history',
  titleSettings: 'BG Tracker — settings',
  streamError: (port) =>
    `Streamer mode: port ${port} is already in use. Pick another one in the Settings.`,
  shortcutsTaken: (keys) =>
    `Shortcuts already used by another application: ${keys}. Use the BG Tracker tray icon menu.`,
  updateAvailable: (v) => `BG Tracker ${v} is available.`,
  updateDetail: 'Download and install now? (file published on GitHub)',
  updateReady: 'The update is ready. Restart BG Tracker to install it?',
  yes: 'Yes',
  later: 'Later',
};

export const menuStrings = (lang: Language): MenuStrings => (lang === 'en' ? en : fr);
