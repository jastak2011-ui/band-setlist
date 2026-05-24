#!/usr/bin/env node
/*
 * One-time migration from ./migration-backup/setlist-copy.db SQLite to PostgreSQL/Supabase.
 * Run from the project root:
 *   node scripts/migrate-sqlite-to-postgres.js
 */

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const root = process.cwd();
const sqlitePath = path.join(root, "migration-backup", "setlist-copy.db");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL. Set it in the environment or .env.local before running this migration.");
    process.exit(1);
  }
  return process.env.DATABASE_URL;
}

function shouldUseSsl(url) {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.PGSSLMODE === "require") return true;
  return /supabase\.(co|com)|render\.com|amazonaws\.com/i.test(url);
}

function tableExists(sqlite, table) {
  return Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnsFor(sqlite, table) {
  if (!tableExists(sqlite, table)) return new Set();
  return new Set(sqlite.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function readAll(sqlite, table) {
  if (!tableExists(sqlite, table)) return [];
  return sqlite.prepare(`SELECT * FROM ${table}`).all();
}

function optional(row, columns, name, fallback = null) {
  return columns.has(name) ? row[name] ?? fallback : fallback;
}

function sqliteTimeToDate(value) {
  if (value == null || value === "") return new Date();
  if (value instanceof Date) return value;
  if (typeof value === "string" && /[T:-]/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return new Date();
  // Existing SQLite data stores Unix seconds. Milliseconds are handled too.
  return new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
}

function boolOrNull(value) {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  return Number(value) === 1;
}

async function addPostgresColumnIfMissing(client, table, column, definition) {
  await client.query("ALTER TABLE " + table + " ADD COLUMN IF NOT EXISTS " + column + " " + definition);
}

async function ensurePostgresSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS bands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      bpm INTEGER,
      musical_key TEXT,
      duration_sec INTEGER,
      energy DOUBLE PRECISION,
      notes TEXT,
      genre TEXT,
      vibe TEXT,
      crowd_score DOUBLE PRECISION,
      danceability DOUBLE PRECISION,
      vocal_difficulty DOUBLE PRECISION,
      opener_candidate BOOLEAN,
      closer_candidate BOOLEAN,
      lead_singer TEXT,
      capo_or_tuning TEXT,
      avoid_after TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS setlists (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      band_id TEXT REFERENCES bands(id) ON DELETE SET NULL,
      title TEXT,
      performed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS setlist_sets (
      id TEXT PRIMARY KEY,
      setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
      set_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS setlist_set_songs (
      id TEXT PRIMARY KEY,
      set_id TEXT NOT NULL REFERENCES setlist_sets(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_setlists_venue ON setlists(venue_id);
    CREATE INDEX IF NOT EXISTS idx_setlists_band ON setlists(band_id);
    CREATE INDEX IF NOT EXISTS idx_setlist_sets_list ON setlist_sets(setlist_id);
    CREATE INDEX IF NOT EXISTS idx_setlist_set_songs_set ON setlist_set_songs(set_id);
    CREATE INDEX IF NOT EXISTS idx_setlist_set_songs_song ON setlist_set_songs(song_id);
  `);

  await addPostgresColumnIfMissing(client, "bands", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "venues", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "songs", "genre", "TEXT");
  await addPostgresColumnIfMissing(client, "songs", "vibe", "TEXT");
  await addPostgresColumnIfMissing(client, "songs", "crowd_score", "DOUBLE PRECISION");
  await addPostgresColumnIfMissing(client, "songs", "danceability", "DOUBLE PRECISION");
  await addPostgresColumnIfMissing(client, "songs", "vocal_difficulty", "DOUBLE PRECISION");
  await addPostgresColumnIfMissing(client, "songs", "opener_candidate", "BOOLEAN");
  await addPostgresColumnIfMissing(client, "songs", "closer_candidate", "BOOLEAN");
  await addPostgresColumnIfMissing(client, "songs", "lead_singer", "TEXT");
  await addPostgresColumnIfMissing(client, "songs", "capo_or_tuning", "TEXT");
  await addPostgresColumnIfMissing(client, "songs", "avoid_after", "TEXT");
  await addPostgresColumnIfMissing(client, "songs", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "setlists", "band_id", "TEXT REFERENCES bands(id) ON DELETE SET NULL");
  await addPostgresColumnIfMissing(client, "setlists", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "setlist_sets", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "setlist_sets", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "setlist_set_songs", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addPostgresColumnIfMissing(client, "setlist_set_songs", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
}

async function upsert(client, sql, params) {
  const result = await client.query(sql, params);
  return result.rows[0]?.inserted ? "inserted" : "updated";
}

function bump(counts, table, outcome) {
  counts[table] ??= { read: 0, inserted: 0, updated: 0 };
  counts[table].read += 1;
  counts[table][outcome] += 1;
}

async function migrate() {
  if (!fs.existsSync(sqlitePath)) {
    console.error(`SQLite database not found at ${sqlitePath}`);
    process.exit(1);
  }

  const databaseUrl = requireDatabaseUrl();
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  const counts = {};

  try {
    sqlite.pragma("wal_checkpoint(PASSIVE)");
    const bands = readAll(sqlite, "bands");
    const venues = readAll(sqlite, "venues");
    const songs = readAll(sqlite, "songs");
    const setlists = readAll(sqlite, "setlists");
    const setlistSets = readAll(sqlite, "setlist_sets");
    const setlistSetSongs = readAll(sqlite, "setlist_set_songs");
    const cols = {
      bands: columnsFor(sqlite, "bands"),
      venues: columnsFor(sqlite, "venues"),
      songs: columnsFor(sqlite, "songs"),
      setlists: columnsFor(sqlite, "setlists"),
      setlist_sets: columnsFor(sqlite, "setlist_sets"),
      setlist_set_songs: columnsFor(sqlite, "setlist_set_songs"),
    };

    await client.query("BEGIN");
    await ensurePostgresSchema(client);

    for (const row of bands) {
      const createdAt = sqliteTimeToDate(optional(row, cols.bands, "created_at"));
      const updatedAt = sqliteTimeToDate(optional(row, cols.bands, "updated_at", optional(row, cols.bands, "created_at")));
      const outcome = await upsert(
        client,
        `INSERT INTO bands (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, created_at = LEAST(bands.created_at, EXCLUDED.created_at), updated_at = GREATEST(bands.updated_at, EXCLUDED.updated_at)
         RETURNING (xmax = 0) AS inserted`,
        [row.id, row.name, createdAt, updatedAt],
      );
      bump(counts, "bands", outcome);
    }

    for (const row of venues) {
      const createdAt = sqliteTimeToDate(optional(row, cols.venues, "created_at"));
      const updatedAt = sqliteTimeToDate(optional(row, cols.venues, "updated_at", optional(row, cols.venues, "created_at")));
      const outcome = await upsert(
        client,
        `INSERT INTO venues (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, created_at = LEAST(venues.created_at, EXCLUDED.created_at), updated_at = GREATEST(venues.updated_at, EXCLUDED.updated_at)
         RETURNING (xmax = 0) AS inserted`,
        [row.id, row.name, createdAt, updatedAt],
      );
      bump(counts, "venues", outcome);
    }

    for (const row of songs) {
      const createdAt = sqliteTimeToDate(optional(row, cols.songs, "created_at"));
      const updatedAt = sqliteTimeToDate(optional(row, cols.songs, "updated_at", optional(row, cols.songs, "created_at")));
      const outcome = await upsert(
        client,
        `INSERT INTO songs (
           id, title, artist, bpm, musical_key, duration_sec, energy, notes, genre, vibe,
           crowd_score, danceability, vocal_difficulty, opener_candidate, closer_candidate,
           lead_singer, capo_or_tuning, avoid_after, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           artist = EXCLUDED.artist,
           bpm = EXCLUDED.bpm,
           musical_key = EXCLUDED.musical_key,
           duration_sec = EXCLUDED.duration_sec,
           energy = EXCLUDED.energy,
           notes = EXCLUDED.notes,
           genre = EXCLUDED.genre,
           vibe = EXCLUDED.vibe,
           crowd_score = EXCLUDED.crowd_score,
           danceability = EXCLUDED.danceability,
           vocal_difficulty = EXCLUDED.vocal_difficulty,
           opener_candidate = EXCLUDED.opener_candidate,
           closer_candidate = EXCLUDED.closer_candidate,
           lead_singer = EXCLUDED.lead_singer,
           capo_or_tuning = EXCLUDED.capo_or_tuning,
           avoid_after = EXCLUDED.avoid_after,
           created_at = LEAST(songs.created_at, EXCLUDED.created_at),
           updated_at = GREATEST(songs.updated_at, EXCLUDED.updated_at)
         RETURNING (xmax = 0) AS inserted`,
        [
          row.id,
          row.title,
          row.artist,
          optional(row, cols.songs, "bpm"),
          optional(row, cols.songs, "musical_key"),
          optional(row, cols.songs, "duration_sec"),
          optional(row, cols.songs, "energy"),
          optional(row, cols.songs, "notes"),
          optional(row, cols.songs, "genre"),
          optional(row, cols.songs, "vibe"),
          optional(row, cols.songs, "crowd_score"),
          optional(row, cols.songs, "danceability"),
          optional(row, cols.songs, "vocal_difficulty"),
          boolOrNull(optional(row, cols.songs, "opener_candidate")),
          boolOrNull(optional(row, cols.songs, "closer_candidate")),
          optional(row, cols.songs, "lead_singer"),
          optional(row, cols.songs, "capo_or_tuning"),
          optional(row, cols.songs, "avoid_after"),
          createdAt,
          updatedAt,
        ],
      );
      bump(counts, "songs", outcome);
    }

    for (const row of setlists) {
      const createdAt = sqliteTimeToDate(optional(row, cols.setlists, "created_at"));
      const updatedAt = sqliteTimeToDate(optional(row, cols.setlists, "updated_at", optional(row, cols.setlists, "created_at")));
      const outcome = await upsert(
        client,
        `INSERT INTO setlists (id, venue_id, band_id, title, performed_at, created_at, updated_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           venue_id = EXCLUDED.venue_id,
           band_id = EXCLUDED.band_id,
           title = EXCLUDED.title,
           performed_at = EXCLUDED.performed_at,
           notes = EXCLUDED.notes,
           created_at = LEAST(setlists.created_at, EXCLUDED.created_at),
           updated_at = GREATEST(setlists.updated_at, EXCLUDED.updated_at)
         RETURNING (xmax = 0) AS inserted`,
        [
          row.id,
          row.venue_id,
          optional(row, cols.setlists, "band_id"),
          optional(row, cols.setlists, "title"),
          optional(row, cols.setlists, "performed_at") == null ? null : sqliteTimeToDate(optional(row, cols.setlists, "performed_at")),
          createdAt,
          updatedAt,
          optional(row, cols.setlists, "notes"),
        ],
      );
      bump(counts, "setlists", outcome);
    }

    for (const row of setlistSets) {
      const now = new Date();
      const outcome = await upsert(
        client,
        `INSERT INTO setlist_sets (id, setlist_id, set_index, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET setlist_id = EXCLUDED.setlist_id, set_index = EXCLUDED.set_index, updated_at = EXCLUDED.updated_at
         RETURNING (xmax = 0) AS inserted`,
        [row.id, row.setlist_id, row.set_index, now, now],
      );
      bump(counts, "setlist_sets", outcome);
    }

    for (const row of setlistSetSongs) {
      const now = new Date();
      const outcome = await upsert(
        client,
        `INSERT INTO setlist_set_songs (id, set_id, song_id, position, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET set_id = EXCLUDED.set_id, song_id = EXCLUDED.song_id, position = EXCLUDED.position, updated_at = EXCLUDED.updated_at
         RETURNING (xmax = 0) AS inserted`,
        [row.id, row.set_id, row.song_id, row.position, now, now],
      );
      bump(counts, "setlist_set_songs", outcome);
    }

    await client.query("COMMIT");

    console.log("SQLite to PostgreSQL migration complete.");
    for (const table of ["bands", "venues", "songs", "setlists", "setlist_sets", "setlist_set_songs"]) {
      const row = counts[table] ?? { read: 0, inserted: 0, updated: 0 };
      console.log(`${table}: read ${row.read}, inserted ${row.inserted}, updated ${row.updated}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
    sqlite.close();
  }
}

migrate();
