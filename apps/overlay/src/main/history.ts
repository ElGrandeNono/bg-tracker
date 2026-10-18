import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { sessionDate, type VisibleView } from '@bgt/core';
import type { CardDb } from '@bgt/data';
import {
  GameRecorder,
  HistoryStore,
  importLogFolder,
  toCsv,
  type GameEdit,
  type GameRecord,
} from '@bgt/history';
import {
  CHANNELS,
  type HistoryGame,
  type HistoryListing,
  type ImportProgress,
} from '../shared/payload.js';

/**
 * Historique local : enregistre chaque partie à partir des vues affichées (donc filtrées), sert le
 * tableau de bord (IPC), exporte en CSV/JSON et importe les parties des anciens logs du jeu.
 * Fichier : `<userData>/history.sqlite`. Aucun envoi réseau.
 */
export class HistoryService {
  private readonly store: HistoryStore;
  private readonly recorder: GameRecorder;

  constructor(
    userDataDir: string,
    private readonly getCardDb: () => CardDb | undefined,
    private readonly windows: () => readonly (BrowserWindow | undefined)[],
  ) {
    this.store = new HistoryStore(join(userDataDir, 'history.sqlite'));
    this.recorder = new GameRecorder((id) => this.heroBase(id));
  }

  private heroBase(cardId: string): string {
    return this.getCardDb()?.baseHero(cardId)?.id ?? cardId;
  }

  /** Date de la session de jeu en cours (dossier `Hearthstone_…`). */
  setSession(path: string | undefined): void {
    const dir = path === undefined ? undefined : basename(join(path, '..'));
    this.recorder.setSessionDate(dir === undefined ? undefined : sessionDate(dir));
  }

  /** À appeler avec chaque vue affichée ; enregistre la partie quand elle se termine. */
  observe(view: VisibleView): void {
    const record = this.recorder.observe(view);
    if (record !== undefined) this.save(record);
  }

  flush(): void {
    const record = this.recorder.flush();
    if (record !== undefined) this.save(record);
  }

  private save(record: GameRecord): void {
    if (record.mode !== 'solo') return; // seul le solo est pris en charge
    if (this.store.insert(record)) this.notifyChanged();
  }

  private notifyChanged(): void {
    for (const w of this.windows()) {
      if (w !== undefined && !w.isDestroyed()) w.webContents.send(CHANNELS.historyChanged);
    }
  }

  private names(ids: Iterable<string>): Record<string, string> {
    const db = this.getCardDb();
    const out: Record<string, string> = {};
    for (const id of ids) out[id] = db?.name(id) ?? id;
    return out;
  }

  listing(): HistoryListing {
    const games = this.store.list();
    return {
      games,
      names: this.names(new Set(games.flatMap((g) => [g.heroCardId, g.heroBaseCardId]))),
    };
  }

  game(id: number): HistoryGame | undefined {
    const game = this.store.get(id);
    if (game === undefined) return undefined;
    const ids = new Set<string>([game.heroCardId]);
    for (const r of game.replay) {
      for (const m of r.localBoard) ids.add(m.cardId);
      for (const m of r.opponent?.board ?? []) ids.add(m.cardId);
      if (r.opponent !== undefined) ids.add(r.opponent.heroCardId);
    }
    return { game, names: this.names(ids) };
  }

  /**
   * Importe les parties BG des dossiers `Logs/Hearthstone_*` (sauf la session en cours, `exclude`).
   * Les doublons sont ignorés (clé : build, date, héros).
   */
  async importLogs(
    logsRoot: string,
    exclude: string | undefined,
    onProgress: (p: ImportProgress) => void,
  ): Promise<number> {
    let added = 0;
    let total = 0;
    const records = await importLogFolder(logsRoot, {
      exclude,
      heroBase: (id) => this.heroBase(id),
      onFile: (done, n, current) => {
        total = n;
        onProgress({ done, total: n, added, current });
      },
    });
    for (const r of records) if (r.mode === 'solo' && this.store.insert(r)) added++;
    onProgress({ done: total, total, added, current: undefined });
    if (added > 0) this.notifyChanged();
    return added;
  }

  async exportGames(
    format: 'csv' | 'json',
    parent: BrowserWindow | undefined,
  ): Promise<string | undefined> {
    const options = {
      title: 'Exporter l’historique',
      defaultPath: `bg-tracker-historique.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    };
    const res =
      parent === undefined
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(parent, options);
    if (res.canceled || res.filePath === '') return undefined;
    const games = this.store.list().map((g) => this.store.get(g.id ?? -1) ?? g);
    await writeFile(
      res.filePath,
      format === 'csv' ? '﻿' + toCsv(games) : JSON.stringify(games, null, 2),
    );
    return res.filePath;
  }

  registerIpc(logsRoot: () => string, currentLog: () => string | undefined): void {
    ipcMain.handle(CHANNELS.historyList, () => this.listing());
    ipcMain.handle(CHANNELS.historyGet, (_e, id: number) => this.game(id));
    ipcMain.handle(CHANNELS.historyUpdate, (_e, id: number, edit: GameEdit) => {
      this.store.update(id, edit);
      this.notifyChanged();
    });
    ipcMain.handle(CHANNELS.historyExport, (e, format: 'csv' | 'json') =>
      this.exportGames(
        format === 'json' ? 'json' : 'csv',
        this.windows().find((w) => w?.webContents === e.sender),
      ),
    );
    ipcMain.handle(CHANNELS.historyImport, (e) =>
      this.importLogs(logsRoot(), currentLog(), (p) => {
        if (!e.sender.isDestroyed()) e.sender.send(CHANNELS.historyProgress, p);
      }),
    );
  }

  close(): void {
    this.store.close();
  }
}
