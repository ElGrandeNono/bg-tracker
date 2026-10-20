import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  DEFAULT_SETTINGS,
  type OverlaySettings,
  type PanelPosition,
  type SettingsPatch,
} from '../shared/payload.js';

/** Réglages de l'overlay, persistés en JSON dans le dossier utilisateur de l'application. */

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function sanitizePanel(v: unknown, fallback: PanelPosition): PanelPosition {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  return { x: clamp(o.x, 0, 0.98, fallback.x), y: clamp(o.y, 0, 0.98, fallback.y) };
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Recopie les booléens connus de `fallback` depuis `v` (les autres clés sont ignorées). */
function bools<T extends object>(v: unknown, fallback: T): T {
  const o = obj(v);
  const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const [k, def] of Object.entries(fallback)) {
    if (typeof def === 'boolean' && typeof o[k] === 'boolean') out[k] = o[k];
  }
  return out as T;
}

/** Applique un patch de la fenêtre Réglages puis repasse par la validation. */
export function applyPatch(current: OverlaySettings, patch: SettingsPatch): OverlaySettings {
  const merged = {
    ...current,
    ...patch,
    sections: { ...current.sections, ...patch.sections },
    alerts: { ...current.alerts, ...patch.alerts },
    streamer: { ...current.streamer, ...patch.streamer },
    panels: patch.resetPanels === true ? DEFAULT_SETTINGS.panels : current.panels,
  };
  return { ...sanitizeSettings(merged), locked: current.locked, backdrop: current.backdrop };
}

export function sanitizeSettings(raw: unknown): OverlaySettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const panels =
    typeof o.panels === 'object' && o.panels !== null ? (o.panels as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    opacity: clamp(o.opacity, 0.3, 1, d.opacity),
    compact: typeof o.compact === 'boolean' ? o.compact : d.compact,
    theme: o.theme === 'light' || o.theme === 'contrast' ? o.theme : 'dark',
    language: o.language === 'en' ? 'en' : 'fr',
    sections: bools(o.sections, d.sections),
    alerts: bools(o.alerts, d.alerts),
    streamer: {
      ...bools(o.streamer, d.streamer),
      port: Math.round(clamp(obj(o.streamer).port, 1024, 65535, d.streamer.port)),
    },
    autoUpdate: typeof o.autoUpdate === 'boolean' ? o.autoUpdate : d.autoUpdate,
    showClock: typeof o.showClock === 'boolean' ? o.showClock : d.showClock,
    simOnClick: typeof o.simOnClick === 'boolean' ? o.simOnClick : d.simOnClick,
    locked: true, // toujours verrouillé au démarrage : jamais d'overlay qui capte la souris par surprise
    // Toujours visible au démarrage : un overlay masqué la veille (Ctrl+Maj+H) semblait cassé.
    hidden: false,
    scale: clamp(o.scale, 0.6, 2, d.scale),
    panels: {
      // Anciennes clés (bar, lobby, avant la 0.8) ignorées : nouvelle disposition par défaut.
      status: sanitizePanel(panels.status, d.panels.status),
      players: sanitizePanel(panels.players, d.panels.players),
      sim: sanitizePanel(panels.sim, d.panels.sim),
      counters: sanitizePanel(panels.counters, d.panels.counters),
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
