import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CHANNELS,
  type BgtBridge,
  type CatalogCard,
  type ImportProgress,
  type OverlayPayload,
} from '../shared/payload.js';

/**
 * Pont minimal et typé vers le renderer (contextIsolation, sandbox) : canaux nommés et typés, aucun accès
 * à Node, au système de fichiers ou à ipcRenderer lui-même.
 */
const bridge: BgtBridge = {
  onUpdate(listener) {
    const handler = (_e: IpcRendererEvent, payload: OverlayPayload): void => {
      listener(payload);
    };
    ipcRenderer.on(CHANNELS.update, handler);
    return () => ipcRenderer.removeListener(CHANNELS.update, handler);
  },
  ready() {
    ipcRenderer.send(CHANNELS.ready);
  },
  saveLayout(panels) {
    ipcRenderer.send(CHANNELS.saveLayout, panels);
  },
  rendered() {
    ipcRenderer.send(CHANNELS.rendered);
  },
  onCatalog(listener) {
    const handler = (_e: IpcRendererEvent, cards: readonly CatalogCard[]): void => {
      listener(cards);
    };
    ipcRenderer.on(CHANNELS.catalog, handler);
    return () => ipcRenderer.removeListener(CHANNELS.catalog, handler);
  },
  openBrowser() {
    ipcRenderer.send(CHANNELS.openBrowser);
  },
  openDashboard() {
    ipcRenderer.send(CHANNELS.openDashboard);
  },
  history: {
    list: () => ipcRenderer.invoke(CHANNELS.historyList),
    get: (id) => ipcRenderer.invoke(CHANNELS.historyGet, id),
    update: (id, edit) => ipcRenderer.invoke(CHANNELS.historyUpdate, id, edit),
    exportGames: (format) => ipcRenderer.invoke(CHANNELS.historyExport, format),
    importLogs: () => ipcRenderer.invoke(CHANNELS.historyImport),
    onChanged(listener) {
      const handler = (): void => {
        listener();
      };
      ipcRenderer.on(CHANNELS.historyChanged, handler);
      return () => ipcRenderer.removeListener(CHANNELS.historyChanged, handler);
    },
    onImportProgress(listener) {
      const handler = (_e: IpcRendererEvent, p: ImportProgress): void => {
        listener(p);
      };
      ipcRenderer.on(CHANNELS.historyProgress, handler);
      return () => ipcRenderer.removeListener(CHANNELS.historyProgress, handler);
    },
  },
};

contextBridge.exposeInMainWorld('bgt', bridge);
