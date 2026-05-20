import type Database from "better-sqlite3";

function ensureColumn(sqlite: Database.Database, table: string, name: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((column) => column.name === name)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export function bootstrapSchema(sqlite: Database.Database) {
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bands (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      bpm INTEGER,
      musical_key TEXT,
      duration_sec INTEGER,
      energy REAL,
      notes TEXT,
      genre TEXT,
      vibe TEXT,
      crowd_score REAL,
      danceability REAL,
      vocal_difficulty REAL,
      opener_candidate INTEGER,
      closer_candidate INTEGER,
      lead_singer TEXT,
      capo_or_tuning TEXT,
      avoid_after TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS setlists (
      id TEXT PRIMARY KEY NOT NULL,
      venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      band_id TEXT REFERENCES bands(id) ON DELETE SET NULL,
      title TEXT,
      performed_at INTEGER,
      created_at INTEGER NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS setlist_sets (
      id TEXT PRIMARY KEY NOT NULL,
      setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
      set_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS setlist_set_songs (
      id TEXT PRIMARY KEY NOT NULL,
      set_id TEXT NOT NULL REFERENCES setlist_sets(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_setlists_venue ON setlists(venue_id);
    CREATE INDEX IF NOT EXISTS idx_setlist_sets_list ON setlist_sets(setlist_id);
    CREATE INDEX IF NOT EXISTS idx_setlist_set_songs_set ON setlist_set_songs(set_id);
  `);

  ensureColumn(sqlite, "setlists", "band_id", "band_id TEXT REFERENCES bands(id) ON DELETE SET NULL");
  ensureColumn(sqlite, "songs", "genre", "genre TEXT");
  ensureColumn(sqlite, "songs", "vibe", "vibe TEXT");
  ensureColumn(sqlite, "songs", "crowd_score", "crowd_score REAL");
  ensureColumn(sqlite, "songs", "danceability", "danceability REAL");
  ensureColumn(sqlite, "songs", "vocal_difficulty", "vocal_difficulty REAL");
  ensureColumn(sqlite, "songs", "opener_candidate", "opener_candidate INTEGER");
  ensureColumn(sqlite, "songs", "closer_candidate", "closer_candidate INTEGER");
  ensureColumn(sqlite, "songs", "lead_singer", "lead_singer TEXT");
  ensureColumn(sqlite, "songs", "capo_or_tuning", "capo_or_tuning TEXT");
  ensureColumn(sqlite, "songs", "avoid_after", "avoid_after TEXT");

  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_setlists_band ON setlists(band_id)");
}
