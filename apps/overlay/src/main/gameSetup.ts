import { readFile, writeFile } from 'node:fs/promises';
import { dialog } from 'electron';
import {
  checkClientConfig,
  checkLogConfig,
  patchClientConfig,
  patchLogConfig,
  type defaultGamePaths,
} from '@bgt/core';

/**
 * Vérifie log.config et client.config au démarrage et propose de les corriger. Rien n'est écrit
 * sans un clic explicite de l'utilisateur. `client.config` est dans le dossier d'installation
 * (souvent `Program Files (x86)`) : sans droits administrateur l'écriture échoue, et on affiche
 * alors la marche à suivre manuelle.
 */

type Paths = ReturnType<typeof defaultGamePaths>;

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export async function checkGameConfig(paths: Paths): Promise<string[]> {
  const log = checkLogConfig(await readOptional(paths.logConfig));
  const client = checkClientConfig(await readOptional(paths.clientConfig));
  return [
    ...log.problems.map((p) => `log.config ${p}`),
    ...client.problems.map((p) => `client.config ${p}`),
  ];
}

export async function offerConfigFixes(paths: Paths): Promise<void> {
  const logText = await readOptional(paths.logConfig);
  if (!checkLogConfig(logText).ok) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'BG Tracker',
      message: 'Les logs de Hearthstone ne sont pas activés.',
      detail: `BG Tracker lit uniquement le fichier Power.log écrit par le jeu. Pour qu'il existe, la section [Power] de ce fichier doit être activée :\n${paths.logConfig}\n\nRelancez Hearthstone après la modification.`,
      buttons: ['Activer les logs', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await writeFile(paths.logConfig, patchLogConfig(logText));
  }

  const clientText = await readOptional(paths.clientConfig);
  if (!checkClientConfig(clientText).ok) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'BG Tracker',
      message: 'Le jeu va tronquer Power.log vers le 13e tour.',
      detail: `Par défaut, Hearthstone arrête d'écrire Power.log à 10 000 Ko, avant la fin d'une partie. Pour lever cette limite, BG Tracker peut ajouter ceci à :\n${paths.clientConfig}\n\n[Log]\nFileSizeLimit.Int=-1\n\n(Effet vérifié : une partie complète de 27 minutes écrite sans troncature.)`,
      buttons: ['Lever la limite', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    try {
      await writeFile(paths.clientConfig, patchClientConfig(clientText));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      await dialog.showMessageBox({
        type: 'warning',
        title: 'BG Tracker',
        message: "Impossible d'écrire client.config.",
        detail: `${code === 'EPERM' || code === 'EACCES' ? 'Le dossier du jeu demande les droits administrateur.' : String(e)}\n\nMarche à suivre manuelle :\n1. Ouvrez le Bloc-notes en tant qu'administrateur.\n2. Créez ou ouvrez ${paths.clientConfig}\n3. Ajoutez les deux lignes :\n[Log]\nFileSizeLimit.Int=-1\n4. Enregistrez, puis relancez Hearthstone.`,
      });
    }
  }
}
