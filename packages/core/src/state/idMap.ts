/**
 * Table persistante (immuable, à partage structurel) indexée par entier positif.
 *
 * Les EntityID de Hearthstone sont denses et croissants (quelques dizaines de milliers par
 * partie). Un trie à deux niveaux de 256 cases suffit : une écriture copie une feuille et la
 * racine (~512 cases) au lieu de toute la table, ce qui rend le reducer immuable viable sur
 * des logs de 400 000 lignes.
 */

const BITS = 8;
const SIZE = 1 << BITS;
const MASK = SIZE - 1;

type Leaf<T> = ReadonlyArray<T | undefined>;

export class IdMap<T> {
  private constructor(
    private readonly root: ReadonlyArray<Leaf<T> | undefined>,
    readonly size: number,
  ) {}

  static empty<T>(): IdMap<T> {
    return new IdMap<T>([], 0);
  }

  get(id: number): T | undefined {
    return this.root[id >>> BITS]?.[id & MASK];
  }

  has(id: number): boolean {
    return this.get(id) !== undefined;
  }

  set(id: number, value: T): IdMap<T> {
    if (!Number.isInteger(id) || id < 0) throw new RangeError(`identifiant invalide : ${id}`);
    const hi = id >>> BITS;
    const lo = id & MASK;
    const leaf = this.root[hi];
    const existed = leaf?.[lo] !== undefined;
    const nextLeaf = leaf === undefined ? new Array<T | undefined>(SIZE) : leaf.slice();
    nextLeaf[lo] = value;
    const nextRoot = this.root.slice();
    nextRoot[hi] = nextLeaf;
    return new IdMap(nextRoot, existed ? this.size : this.size + 1);
  }

  *values(): IterableIterator<T> {
    for (const leaf of this.root) {
      if (leaf === undefined) continue;
      for (const v of leaf) if (v !== undefined) yield v;
    }
  }
}
