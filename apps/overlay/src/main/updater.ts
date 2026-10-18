import { dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { menuStrings } from './menuStrings.js';

/**
 * Mises à jour (opt-in, désactivées par défaut) : interroge les releases GitHub du dépôt
 * (fichier `latest.yml` publié par la CI). Rien n'est téléchargé sans l'accord explicite de
 * l'utilisateur, et rien n'est envoyé d'autre que la requête HTTP elle-même.
 */

let checking = false;

export async function checkForUpdates(
  strings: () => ReturnType<typeof menuStrings>,
): Promise<void> {
  if (checking) return;
  checking = true;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable !== true) return;
    const s = strings();
    const choice = await dialog.showMessageBox({
      type: 'info',
      message: s.updateAvailable(result.updateInfo.version),
      detail: s.updateDetail,
      buttons: [s.yes, s.later],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) return;
    await autoUpdater.downloadUpdate();
    const restart = await dialog.showMessageBox({
      type: 'info',
      message: strings().updateReady,
      buttons: [s.yes, s.later],
      defaultId: 0,
      cancelId: 1,
    });
    if (restart.response === 0) autoUpdater.quitAndInstall();
    else autoUpdater.autoInstallOnAppQuit = true;
  } catch {
    // hors ligne ou aucune release publiée : on réessaiera au prochain démarrage
  } finally {
    checking = false;
  }
}
