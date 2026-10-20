/**
 * Noms des tribus tels que le JEU les affiche (bandeau « Choisissez un héros », infobulle
 * « Dans cette partie »), en français et en anglais, sans accents, en minuscules.
 * Français : relevés sur les captures de l'utilisateur du 20/10/2026 (Aberrations, Dragons,
 * Morts-vivants, Pirates, Élémentaires ; Bêtes, Démons, Hurans, Murlocs, Mécas).
 */
const GAME_NAMES: Readonly<Record<string, readonly string[]>> = {
  ABERRATION: ['aberrations', 'aberration'],
  BEAST: ['betes', 'beasts'],
  DEMON: ['demons'],
  DRAGON: ['dragons'],
  ELEMENTALS: ['elementaires', 'elementals'],
  QUILLBOAR: ['hurans', 'quilboar'],
  MECH: ['mecas', 'mechs'],
  MURLOC: ['murlocs'],
  NAGA: ['nagas', 'naga'],
  PIRATE: ['pirates'],
  UNDEAD: ['morts-vivants', 'undead'],
};

const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * Tribus reconnues dans un texte OCR, dans l'ordre de lecture et sans doublon. Tolère une
 * erreur de lecture par tranche de 6 lettres (OCR sur un fond décoré).
 */
export function matchTribes(text: string): string[] {
  const words = normalize(text).match(/[a-z]+(?:-[a-z]+)?/g) ?? [];
  const found: string[] = [];
  for (const word of words) {
    if (word.length < 4) continue;
    for (const [tribe, names] of Object.entries(GAME_NAMES)) {
      if (found.includes(tribe)) continue;
      if (names.some((n) => distance(word, n) <= Math.floor(n.length / 6))) {
        found.push(tribe);
        break;
      }
    }
  }
  return found;
}
