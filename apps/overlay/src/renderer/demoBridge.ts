import type { BgtBridge, OverlayPayload } from '../shared/payload.js';

/**
 * Pont de démonstration pour le navigateur : charge `demo.json` (instantanés générés par
 * `node build.mjs --demo-only` à partir d'une fixture anonymisée) et permet de les parcourir
 * avec ← / →. Uniquement pour le développement de l'UI.
 */
export function demoBridge(): BgtBridge {
  const listeners = new Set<(p: OverlayPayload) => void>();
  let frames: OverlayPayload[] = [];
  let index = 0;
  const emit = (): void => {
    const frame = frames[index];
    if (frame !== undefined) for (const l of listeners) l(frame);
  };
  void fetch('./demo.json')
    .then((r) => r.json() as Promise<OverlayPayload[]>)
    .then((f) => {
      frames = f;
      fromHash();
    });
  const fromHash = (): void => {
    const raw = location.hash.slice(1);
    const n = raw === '' ? NaN : Number(raw);
    index = Number.isInteger(n) && n >= 0 && n < frames.length ? n : frames.length - 1;
    emit();
  };
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') index = Math.min(frames.length - 1, index + 1);
    else if (e.key === 'ArrowLeft') index = Math.max(0, index - 1);
    else return;
    location.hash = String(index); // déclenche hashchange → emit
  });
  return {
    onUpdate(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ready() {},
    saveLayout() {},
    rendered() {},
  };
}
