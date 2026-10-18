import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type OverlaySettings } from '../shared/payload.js';

/** Réglages de l'overlay, persistés en JSON dans le dossier utilisateur de l'application. */

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function sanitizePanel(
  v: unknown,
  fallback: OverlaySettings['panels']['bar'],
): OverlaySettings['panels']['bar'] {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  return { x: clamp(o.x, 0, 0.98, fallback.x), y: clamp(o.y, 0, 0.98, fallback.y) };
}

export function sanitizeSettings(raw: unknown): OverlaySettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const panels =
    typeof o.panels === 'object' && o.panels !== null ? (o.panels as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    opacity: clamp(o.opacity, 0.3, 1, d.opacity),
    compact: typeof o.compact === 'boolean' ? o.compact : d.compact,
    theme: o.theme === 'light' ? 'light' : 'dark',
    locked: true, // toujours verrouillé au démarrage : jamais d'overlay qui capte la souris par surprise
    hidden: typeof o.hidden === 'boolean' ? o.hidden : d.hidden,
    scale: clamp(o.scale, 0.6, 2, d.scale),
    panels: {
      bar: sanitizePanel(panels.bar, d.panels.bar),
      lobby: sanitizePanel(panels.lobby, d.panels.lobby),
    },
    backdrop: false,
  };
}

export function loadSettings(file: string): OverlaySettings {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(file: string, settings: OverlaySettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  // `backdrop` ne s'applique qu'à la session (mode autonome) : jamais persisté.
  const persisted = { ...settings, backdrop: undefined };
  await writeFile(`${file}.tmp`, JSON.stringify(persisted, null, 2));
  await rename(`${file}.tmp`, file);
}
