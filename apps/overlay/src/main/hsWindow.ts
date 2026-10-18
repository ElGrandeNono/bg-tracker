import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

/**
 * Suivi de la fenêtre Hearthstone (Windows) : position et taille de la zone client, minimisée,
 * au premier plan. On interroge le GESTIONNAIRE DE FENÊTRES de Windows (user32 : FindWindowW,
 * GetClientRect, ClientToScreen, IsIconic, GetForegroundWindow), comme tout outil
 * d'accessibilité. Aucune lecture de la mémoire du jeu, aucune injection, aucune entrée
 * simulée (règle non négociable n°1).
 *
 * Appels directs par FFI (koffi, MIT) dans le processus principal. Une première version passait
 * par un PowerShell masqué (`-EncodedCommand` + Add-Type) : l'antivirus de l'utilisateur (Avast)
 * a supprimé electron.exe juste après, ce schéma étant typique des malwares. Plus de processus
 * enfant ni de script encodé.
 *
 * Fenêtre identifiée par son titre `Hearthstone` ET sa classe `UnityWndClass` (vérifiées le
 * 18/10/2026 sur le jeu de l'utilisateur). Electron étant DPI-aware, les coordonnées sont en
 * pixels physiques ; la conversion en DIP se fait dans main.ts (`screen.screenToDipRect`).
 */

export interface HsWindowSample {
  readonly found: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly minimized: boolean;
  readonly foreground: boolean;
}

const NOT_FOUND: HsWindowSample = {
  found: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  minimized: false,
  foreground: false,
};

const WINDOW_TITLE = 'Hearthstone';
const WINDOW_CLASS = 'UnityWndClass';

interface User32 {
  findWindow(title: string): unknown;
  className(h: unknown): string;
  clientRect(h: unknown): { x: number; y: number; width: number; height: number } | undefined;
  isIconic(h: unknown): boolean;
  isWindow(h: unknown): boolean;
  foreground(): unknown;
  same(a: unknown, b: unknown): boolean;
}

interface KoffiLike {
  load(lib: string): { func(signature: string): (...args: unknown[]) => unknown };
  struct(name: string, def: Record<string, string>): unknown;
  address(ptr: unknown): bigint;
}

function loadUser32(): User32 {
  const koffi = createRequire(import.meta.url)('koffi') as KoffiLike;
  koffi.struct('BGT_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  koffi.struct('BGT_POINT', { x: 'long', y: 'long' });
  const u = koffi.load('user32.dll');
  const FindWindowW = u.func('void* __stdcall FindWindowW(const char16_t*, const char16_t*)');
  const GetClassNameW = u.func('int __stdcall GetClassNameW(void*, _Out_ char16_t*, int)');
  const GetClientRect = u.func('bool __stdcall GetClientRect(void*, _Out_ BGT_RECT*)');
  const ClientToScreen = u.func('bool __stdcall ClientToScreen(void*, _Inout_ BGT_POINT*)');
  const IsIconic = u.func('bool __stdcall IsIconic(void*)');
  const IsWindow = u.func('bool __stdcall IsWindow(void*)');
  const GetForegroundWindow = u.func('void* __stdcall GetForegroundWindow()');
  return {
    findWindow: (title) => FindWindowW(null, title),
    className: (h) => {
      const buf = Buffer.alloc(512);
      const n = GetClassNameW(h, buf, 256) as number;
      return buf.toString('utf16le', 0, n * 2);
    },
    clientRect: (h) => {
      const r = { left: 0, top: 0, right: 0, bottom: 0 };
      const p = { x: 0, y: 0 };
      if (GetClientRect(h, r) !== true || ClientToScreen(h, p) !== true) return undefined;
      return { x: p.x, y: p.y, width: r.right - r.left, height: r.bottom - r.top };
    },
    isIconic: (h) => IsIconic(h) === true,
    isWindow: (h) => IsWindow(h) === true,
    foreground: () => GetForegroundWindow(),
    same: (a, b) => a !== null && b !== null && koffi.address(a) === koffi.address(b),
  };
}

export class HsWindowTracker extends EventEmitter<{ sample: [HsWindowSample] }> {
  private timer: NodeJS.Timeout | undefined;
  private user32: User32 | undefined;
  private handle: unknown = null;
  private lookupCooldown = 0;
  private last = '';

  constructor(private readonly pollMs = 500) {
    super();
  }

  start(): void {
    if (process.platform !== 'win32' || this.timer !== undefined) return;
    try {
      this.user32 = loadUser32();
    } catch {
      return; // FFI indisponible : l'overlay reste utilisable en mode autonome
    }
    this.poll();
    this.timer = setInterval(() => {
      this.poll();
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private findHandle(u: User32): unknown {
    if (this.handle !== null && u.isWindow(this.handle)) return this.handle;
    this.handle = null;
    if (this.lookupCooldown-- > 0) return null;
    this.lookupCooldown = 4; // recherche au plus toutes les ~2,5 s quand le jeu est fermé
    const h = u.findWindow(WINDOW_TITLE);
    if (h !== null && u.className(h) === WINDOW_CLASS) this.handle = h;
    return this.handle;
  }

  private poll(): void {
    const u = this.user32;
    if (u === undefined) return;
    let sample = NOT_FOUND;
    try {
      const h = this.findHandle(u);
      const rect = h === null ? undefined : u.clientRect(h);
      if (h !== null && rect !== undefined) {
        sample = {
          found: true,
          ...rect,
          minimized: u.isIconic(h),
          foreground: u.same(u.foreground(), h),
        };
      }
    } catch {
      this.handle = null;
    }
    const key = JSON.stringify(sample);
    if (key === this.last) return; // n'émet que les changements
    this.last = key;
    this.emit('sample', sample);
  }
}
