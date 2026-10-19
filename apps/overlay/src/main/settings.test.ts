import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/payload.js';
import { applyPatch, sanitizeSettings } from './settings.js';

describe('réglages de l’overlay', () => {
  it('revient aux valeurs par défaut sur un fichier illisible', () => {
    expect(sanitizeSettings('n’importe quoi')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('borne les valeurs et démarre toujours verrouillé (click-through)', () => {
    const s = sanitizeSettings({
      opacity: 7,
      scale: 0.1,
      locked: false,
      theme: 'light',
      panels: { status: { x: -1, y: 0.5 }, players: { x: 2, y: 'a' }, bar: { x: 0.1, y: 0.1 } },
      backdrop: true,
    });
    expect(s.opacity).toBe(1);
    expect(s.scale).toBe(0.6);
    expect(s.locked).toBe(true);
    expect(s.theme).toBe('light');
    expect(s.panels.status).toEqual({ x: 0, y: 0.5 });
    expect(s.panels.players).toEqual({ x: 0.98, y: DEFAULT_SETTINGS.panels.players.y });
    expect(s.panels.sim).toEqual(DEFAULT_SETTINGS.panels.sim); // ancienne clé « bar » ignorée
    expect(s.backdrop).toBe(false);
    expect(sanitizeSettings({ hidden: true }).hidden).toBe(false);
  });

  it('fusionne un patch de la fenêtre Réglages, toujours revalidé', () => {
    const cur = {
      ...DEFAULT_SETTINGS,
      locked: false,
      panels: { ...DEFAULT_SETTINGS.panels, status: { x: 0.5, y: 0.5 } },
    };
    const s = applyPatch(cur, {
      language: 'en',
      theme: 'contrast',
      sections: { pool: false },
      alerts: { sound: true },
      streamer: { enabled: true, port: 80 },
      opacity: 9,
    });
    expect(s.language).toBe('en');
    expect(s.theme).toBe('contrast');
    expect(s.sections).toEqual({ ...DEFAULT_SETTINGS.sections, pool: false });
    expect(s.alerts.sound).toBe(true);
    expect(s.streamer.enabled).toBe(true);
    expect(s.streamer.port).toBe(1024); // ports privilégiés refusés
    expect(s.opacity).toBe(1);
    expect(s.locked).toBe(false); // le patch ne touche pas au verrouillage
    expect(s.panels.status).toEqual({ x: 0.5, y: 0.5 });
    expect(applyPatch(cur, { resetPanels: true }).panels).toEqual(DEFAULT_SETTINGS.panels);
  });

  it('réseau désactivé par défaut : serveur OBS et mises à jour', () => {
    expect(DEFAULT_SETTINGS.streamer.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.autoUpdate).toBe(false);
  });
});
