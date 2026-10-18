import type { BgtBridge } from '../shared/payload.js';

declare global {
  interface Window {
    /** Exposé par le preload dans Electron ; absent dans un navigateur (mode démo). */
    readonly bgt?: BgtBridge;
  }
}

export {};
