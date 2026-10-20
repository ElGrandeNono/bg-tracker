import { describe, expect, it } from 'vitest';
import { matchTribes } from './tribeNames.js';

describe('tribus lues à l’écran', () => {
  it('texte OCR réel du bandeau « Choisissez un héros » (capture du 20/10/2026)', () => {
    // Sortie brute de tesseract.js sur la zone du bandeau, parasites compris.
    const ocr =
      'ét en doi A\nAberrations, Dragons,\nMorts-vivants, Pirates, ; LS\n_…_ * _ Élémentaires Eu”\nPAR';
    expect(matchTribes(ocr)).toEqual(['ABERRATION', 'DRAGON', 'UNDEAD', 'PIRATE', 'ELEMENTALS']);
  });

  it('tolère une lettre mal lue, ignore les mots courts et les doublons (synthetic)', () => {
    expect(matchTribes('Murlocs, Mécas, Hurens, Bêtes, Démons, Murlocs, de, la')).toEqual([
      'MURLOC',
      'MECH',
      'QUILLBOAR',
      'BEAST',
      'DEMON',
    ]);
  });

  it('noms anglais (synthetic)', () => {
    expect(matchTribes('Beasts, Undead, Quilboar, Naga, Mechs')).toEqual([
      'BEAST',
      'UNDEAD',
      'QUILLBOAR',
      'NAGA',
      'MECH',
    ]);
  });
});
