import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CHANNELS,
  type BgtBridge,
  type CatalogCard,
  type OverlayPayload,
} from '../shared/payload.js';

/**
 * Pont minimal et typé vers le renderer (contextIsolation, sandbox) : six canaux, aucun accès
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
};

contextBridge.exposeInMainWorld('bgt', bridge);
