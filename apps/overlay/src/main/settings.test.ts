import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/payload.js';
import { sanitizeSettings } from './settings.js';

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
      panels: { bar: { x: -1, y: 0.5 }, lobby: { x: 2, y: 'a' } },
      backdrop: true,
    });
    expect(s.opacity).toBe(1);
    expect(s.scale).toBe(0.6);
    expect(s.locked).toBe(true);
    expect(s.theme).toBe('light');
    expect(s.panels.bar).toEqual({ x: 0, y: 0.5 });
    expect(s.panels.lobby).toEqual({ x: 0.98, y: DEFAULT_SETTINGS.panels.lobby.y });
    expect(s.backdrop).toBe(false);
  });
});
