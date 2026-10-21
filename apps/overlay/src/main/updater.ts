import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../shared/payload.js';
import type { menuStrings } from './menuStrings.js';

/**
 * Mises à jour (opt-in, désactivées par défaut) : interroge la dernière release PUBLIÉE du dépôt
 * GitHub (fichier `latest.yml` joint par la CI). Rien n'est téléchargé sans l'accord explicite de
 * l'utilisateur, et rien n'est envoyé d'autre que la requête HTTP elle-même. Installeur non signé :
 * pas de `publisherName`, donc pas de vérification de signature (qui passerait par PowerShell).
 */

let checking = false;

export async function checkForUpdates(
  strings: () => ReturnType<typeof menuStrings>,
  onStatus: (s: UpdateStatus) => void,
): Promise<void> {
  if (checking) return;
  if (!app.isPackaged) {
    onStatus({ state: 'devBuild' });
    return;
  }
  checking = true;
  onStatus({ state: 'checking' });
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable !== true) {
      onStatus({ state: 'upToDate' });
      return;
    }
    const version = result.updateInfo.version;
    onStatus({ state: 'available', version });
    const s = strings();
    const choice = await dialog.showMessageBox({
      type: 'info',
      message: s.updateAvailable(version),
      detail: s.updateDetail,
      buttons: [s.yes, s.later],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) return;
    onStatus({ state: 'downloading', version });
    await autoUpdater.downloadUpdate();
    onStatus({ state: 'ready', version });
    const restart = await dialog.showMessageBox({
      type: 'info',
      message: strings().updateReady,
      buttons: [s.yes, s.later],
      defaultId: 0,
      cancelId: 1,
    });
    if (restart.response === 0) autoUpdater.quitAndInstall();
    else autoUpdater.autoInstallOnAppQuit = true;
  } catch (e) {
    // 404 : aucune release publiée sur le dépôt ; sinon hors ligne ou GitHub injoignable.
    onStatus({ state: /\b404\b/.test(String(e)) ? 'noRelease' : 'error' });
  } finally {
    checking = false;
  }
}
