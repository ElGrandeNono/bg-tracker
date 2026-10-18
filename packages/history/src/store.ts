import { DatabaseSync } from 'node:sqlite';
import type { GameEdit, GameRecord, ReplayRound } from './types.js';

/**
 * Historique local en SQLite via `node:sqlite` (intégré à Node 24 et à Electron 44 : aucun module
 * natif à compiler). Un fichier dans le dossier utilisateur ; rien n'est envoyé sur le réseau.
 * Migrations numérotées : `PRAGMA user_version` donne la version du schéma.
 */

const MIGRATIONS: readonly string[] = [
  // v1
  `CREATE TABLE games (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     key TEXT NOT NULL UNIQUE,
     started_at TEXT,
     build TEXT,
     mode TEXT NOT NULL,
     hero_card_id TEXT NOT NULL,
     hero_base_card_id TEXT NOT NULL,
     outcome TEXT NOT NULL,
     final_place INTEGER,
     tribes TEXT NOT NULL,
     rounds INTEGER NOT NULL,
     duration_ms INTEGER,
     truncated INTEGER NOT NULL,
     mmr INTEGER,
     notes TEXT NOT NULL DEFAULT '',
     tags TEXT NOT NULL DEFAULT '[]',
     replay TEXT NOT NULL DEFAULT '[]'
   );
   CREATE INDEX games_started_at ON games(started_at);`,
];

interface Row {
  id: number;
  key: string;
  started_at: string | null;
  build: string | null;
  mode: string;
  hero_card_id: string;
  hero_base_card_id: string;
  outcome: string;
  final_place: number | null;
  tribes: string;
  rounds: number;
  duration_ms: number | null;
  truncated: number;
  mmr: number | null;
  notes: string;
  tags: string;
  replay: string;
}

const COLUMNS =
  'id, key, started_at, build, mode, hero_card_id, hero_base_card_id, outcome, final_place, tribes, rounds, duration_ms, truncated, mmr, notes, tags';

function fromRow(r: Row, replay: readonly ReplayRound[] = []): GameRecord {
  return {
    id: r.id,
    key: r.key,
    startedAt: r.started_at ?? undefined,
    build: r.build ?? undefined,
    mode: r.mode as GameRecord['mode'],
    heroCardId: r.hero_card_id,
    heroBaseCardId: r.hero_base_card_id,
    outcome: r.outcome as GameRecord['outcome'],
    finalPlace: r.final_place ?? undefined,
    tribes: JSON.parse(r.tribes) as string[],
    rounds: r.rounds,
    durationMs: r.duration_ms ?? undefined,
    truncated: r.truncated === 1,
    mmr: r.mmr ?? undefined,
    notes: r.notes,
    tags: JSON.parse(r.tags) as string[],
    replay,
  };
}

export class HistoryStore {
  private readonly db: DatabaseSync;

  /** `path` : fichier SQLite, ou `:memory:` (tests). */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  get schemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as
      { user_version: number } | undefined;
    return row?.user_version ?? 0;
  }

  private migrate(): void {
    for (let v = this.schemaVersion; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v] ?? '');
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  /** Insère une partie ; ignorée si sa clé existe déjà. Renvoie vrai si elle a été ajoutée. */
  insert(g: GameRecord): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO games (key, started_at, build, mode, hero_card_id, hero_base_card_id, outcome,
           final_place, tribes, rounds, duration_ms, truncated, mmr, notes, tags, replay)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        g.key,
        g.startedAt ?? null,
        g.build ?? null,
        g.mode,
        g.heroCardId,
        g.heroBaseCardId,
        g.outcome,
        g.finalPlace ?? null,
        JSON.stringify(g.tribes),
        g.rounds,
        g.durationMs ?? null,
        g.truncated ? 1 : 0,
        g.mmr ?? null,
        g.notes,
        JSON.stringify(g.tags),
        JSON.stringify(g.replay),
      );
    return Number(res.changes) > 0;
  }

  /** Toutes les parties, de la plus récente à la plus ancienne, SANS le replay (léger). */
  list(): GameRecord[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM games ORDER BY started_at DESC, id DESC`)
      .all() as unknown as Row[];
    return rows.map((r) => fromRow(r));
  }

  /** Une partie avec son replay. */
  get(id: number): GameRecord | undefined {
    const r = this.db
      .prepare(`SELECT ${COLUMNS}, replay FROM games WHERE id = ?`)
      .get(id) as unknown as Row | undefined;
    return r === undefined ? undefined : fromRow(r, JSON.parse(r.replay) as ReplayRound[]);
  }

  update(id: number, edit: GameEdit): void {
    const current = this.get(id);
    if (current === undefined) return;
    this.db
      .prepare('UPDATE games SET mmr = ?, notes = ?, tags = ? WHERE id = ?')
      .run(
        'mmr' in edit ? (edit.mmr ?? null) : (current.mmr ?? null),
        edit.notes ?? current.notes,
        JSON.stringify(edit.tags ?? current.tags),
        id,
      );
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM games WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
