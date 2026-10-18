import { useEffect, useRef, useState } from 'react';
import type { PoolSighting } from '@bgt/core';
import type { AlertSettings, OverlayPayload } from '../shared/payload.js';
import type { Messages } from './i18n.js';

/**
 * Alertes configurables (Réglages › Alertes). Elles ne s'appuient que sur la vue filtrée : début
 * du recrutement, minuteur sous 10 s, triple réalisable avec la boutique affichée, tribus du lobby
 * identifiées. Chaque alerte ne se déclenche qu'une fois par occasion. Son optionnel synthétisé en
 * WebAudio (aucun fichier audio embarqué).
 */

export interface Toast {
  readonly id: number;
  readonly text: string;
}

export type AlertKind = Exclude<keyof AlertSettings, 'sound'>;

/** Cartes dont deux exemplaires non dorés sont au joueur (main + plateau) et le troisième en boutique. */
export function tripleCandidates(sightings: readonly PoolSighting[]): string[] {
  const own = new Map<string, number>();
  const shop = new Set<string>();
  for (const s of sightings) {
    if (s.golden) continue;
    if (s.source === 'local') own.set(s.cardId, (own.get(s.cardId) ?? 0) + 1);
    else if (s.source === 'shop') shop.add(s.cardId);
  }
  return [...own].filter(([id, n]) => n >= 2 && shop.has(id)).map(([id]) => id);
}

/** Alertes dues pour cette vue ; `fired` mémorise celles déjà émises (clé = occasion). */
export function dueAlerts(
  p: OverlayPayload,
  now: number,
  t: Messages,
  fired: Set<string>,
): string[] {
  const { view, settings } = p;
  const a = settings.alerts;
  if (!view.isBattlegrounds || view.mode !== 'solo' || view.outcome !== 'inProgress') return [];
  const out: string[] = [];
  const once = (key: string, text: string): void => {
    const k = `${view.gameIndex}:${key}`;
    if (fired.has(k)) return;
    fired.add(k);
    out.push(text);
  };
  const recruit = view.phase === 'recruit';
  if (a.turnStart && recruit) once(`turn:${view.round}`, t.alerts.turnStart(view.round));
  if (a.timerLow && recruit && p.timerEndsAt !== undefined) {
    const left = p.timerEndsAt - now;
    if (left > 0 && left < 10_000) once(`timer:${view.round}`, t.alerts.timerLow);
  }
  if (a.triple && recruit) {
    for (const id of tripleCandidates(view.poolSightings)) {
      once(`triple:${view.round}:${id}`, t.alerts.triple(p.names[id] ?? id));
    }
  }
  const tribes = view.tribes;
  if (a.tribesFound && tribes.identified.length >= tribes.expected && tribes.expected > 0) {
    once('tribes', t.alerts.tribesFound(tribes.identified.map((x) => t.tribes[x] ?? x).join(', ')));
  }
  return out;
}

let audio: AudioContext | undefined;

function beep(): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.2);
  } catch {
    // pas de sortie audio : l'alerte reste visuelle
  }
}

const TOAST_MS = 4000;

export function useAlerts(
  payload: OverlayPayload | undefined,
  now: number,
  t: Messages,
): readonly Toast[] {
  const fired = useRef(new Set<string>());
  const nextId = useRef(1);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  useEffect(() => {
    if (payload === undefined) return;
    const texts = dueAlerts(payload, now, t, fired.current);
    if (texts.length === 0) return;
    if (payload.settings.alerts.sound) beep();
    const added = texts.map((text) => ({ id: nextId.current++, text }));
    setToasts((cur) => [...cur, ...added].slice(-3));
    // Pas d'annulation au re-rendu : `now` change toutes les 250 ms pendant le recrutement.
    setTimeout(() => {
      setToasts((cur) => cur.filter((x) => !added.includes(x)));
    }, TOAST_MS);
  }, [payload, now, t]);
  return toasts;
}
