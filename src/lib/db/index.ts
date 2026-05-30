import { Pool, type PoolClient, type QueryResultRow } from "pg";

type Queryable = Pool | PoolClient;

let pool: Pool | null = null;
let bootstrapPromise: Promise<void> | null = null;

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is required for PostgreSQL storage.");
  }
  return value;
}

function shouldUseSsl(url: string) {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.NODE_ENV === "production") return true;
  return /supabase\.(co|com)|render\.com|amazonaws\.com/i.test(url);
}

export function getPool() {
  if (pool) return pool;
  const url = connectionString();
  pool = new Pool({
    connectionString: url,
    ssl: shouldUseSsl(url) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  await ensureDatabase();
  return getPool().query<T>(text, params);
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDatabase() {
  if (!bootstrapPromise) bootstrapPromise = bootstrapDatabase(getPool());
  return bootstrapPromise;
}

async function addColumnIfMissing(db: Queryable, table: string, column: string, definition: string) {
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
}

async function bootstrapDatabase(db: Queryable) {
  await db.query(`
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
      singalong_score DOUBLE PRECISION,
      peak_hour_score DOUBLE PRECISION,
      transition_flexibility DOUBLE PRECISION,
      audience_age_appeal TEXT[],
      female_participation_score DOUBLE PRECISION,
      singalong_score_source TEXT,
      peak_hour_score_source TEXT,
      transition_flexibility_source TEXT,
      audience_age_appeal_source TEXT,
      female_participation_score_source TEXT,
      opener_candidate BOOLEAN,
      closer_candidate BOOLEAN,
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
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      disabled_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS song_performance_ratings (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
      band_id TEXT REFERENCES bands(id) ON DELETE SET NULL,
      venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      performance_date TIMESTAMPTZ,
      crowd_response_score INTEGER CHECK (crowd_response_score IS NULL OR (crowd_response_score >= 1 AND crowd_response_score <= 10)),
      notes TEXT,
      created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (song_id, setlist_id)
    );

    CREATE INDEX IF NOT EXISTS idx_song_performance_ratings_song ON song_performance_ratings(song_id);
    CREATE INDEX IF NOT EXISTS idx_song_performance_ratings_venue ON song_performance_ratings(venue_id);
    CREATE INDEX IF NOT EXISTS idx_song_performance_ratings_band ON song_performance_ratings(band_id);
    CREATE INDEX IF NOT EXISTS idx_song_performance_ratings_setlist ON song_performance_ratings(setlist_id);

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS band_memberships (
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, band_id)
    );

    CREATE INDEX IF NOT EXISTS idx_band_memberships_band ON band_memberships(band_id);

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      invited_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invitation_bands (
      invitation_id TEXT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
      band_id TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (invitation_id, band_id)
    );

    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(lower(email));
  `);

  await addColumnIfMissing(db, "bands", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "venues", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "songs", "genre", "TEXT");
  await addColumnIfMissing(db, "songs", "vibe", "TEXT");
  await addColumnIfMissing(db, "songs", "crowd_score", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "danceability", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "vocal_difficulty", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "singalong_score", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "peak_hour_score", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "transition_flexibility", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "audience_age_appeal", "TEXT[]");
  await addColumnIfMissing(db, "songs", "female_participation_score", "DOUBLE PRECISION");
  await addColumnIfMissing(db, "songs", "singalong_score_source", "TEXT");
  await addColumnIfMissing(db, "songs", "peak_hour_score_source", "TEXT");
  await addColumnIfMissing(db, "songs", "transition_flexibility_source", "TEXT");
  await addColumnIfMissing(db, "songs", "audience_age_appeal_source", "TEXT");
  await addColumnIfMissing(db, "songs", "female_participation_score_source", "TEXT");
  await addColumnIfMissing(db, "songs", "opener_candidate", "BOOLEAN");
  await addColumnIfMissing(db, "songs", "closer_candidate", "BOOLEAN");
  await addColumnIfMissing(db, "songs", "capo_or_tuning", "TEXT");
  await addColumnIfMissing(db, "songs", "avoid_after", "TEXT");
  await addColumnIfMissing(db, "songs", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "setlists", "band_id", "TEXT REFERENCES bands(id) ON DELETE SET NULL");
  await addColumnIfMissing(db, "setlists", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "setlist_sets", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "setlist_sets", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "setlist_set_songs", "created_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "setlist_set_songs", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "app_users", "display_name", "TEXT");
  await addColumnIfMissing(db, "app_users", "disabled_at", "TIMESTAMPTZ");
  await addColumnIfMissing(db, "app_users", "last_seen_at", "TIMESTAMPTZ");
  await addColumnIfMissing(db, "app_users", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "user_roles", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "band_memberships", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await addColumnIfMissing(db, "invitations", "accepted_at", "TIMESTAMPTZ");
}

export type DbSong = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  musicalKey: string | null;
  durationSec: number | null;
  energy: number | null;
  notes: string | null;
  genre: string | null;
  vibe: string | null;
  crowdScore: number | null;
  danceability: number | null;
  vocalDifficulty: number | null;
  singalongScore: number | null;
  peakHourScore: number | null;
  transitionFlexibility: number | null;
  audienceAgeAppeal: string[] | null;
  femaleParticipationScore: number | null;
  singalongScoreSource: string | null;
  peakHourScoreSource: string | null;
  transitionFlexibilitySource: string | null;
  audienceAgeAppealSource: string | null;
  femaleParticipationScoreSource: string | null;
  openerCandidate: boolean | null;
  closerCandidate: boolean | null;
  capoOrTuning: string | null;
  avoidAfter: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DbSetlist = {
  id: string;
  venueId: string;
  bandId: string | null;
  title: string | null;
  performedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notes: string | null;
};

export function mapSong(row: QueryResultRow): DbSong {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    bpm: row.bpm,
    musicalKey: row.musical_key,
    durationSec: row.duration_sec,
    energy: row.energy,
    notes: row.notes,
    genre: row.genre,
    vibe: row.vibe,
    crowdScore: row.crowd_score,
    danceability: row.danceability,
    vocalDifficulty: row.vocal_difficulty,
    singalongScore: row.singalong_score,
    peakHourScore: row.peak_hour_score,
    transitionFlexibility: row.transition_flexibility,
    audienceAgeAppeal: row.audience_age_appeal ?? null,
    femaleParticipationScore: row.female_participation_score,
    singalongScoreSource: row.singalong_score_source,
    peakHourScoreSource: row.peak_hour_score_source,
    transitionFlexibilitySource: row.transition_flexibility_source,
    audienceAgeAppealSource: row.audience_age_appeal_source,
    femaleParticipationScoreSource: row.female_participation_score_source,
    openerCandidate: row.opener_candidate,
    closerCandidate: row.closer_candidate,
    capoOrTuning: row.capo_or_tuning,
    avoidAfter: row.avoid_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSetlist(row: QueryResultRow): DbSetlist {
  return {
    id: row.id,
    venueId: row.venue_id,
    bandId: row.band_id,
    title: row.title,
    performedAt: row.performed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: row.notes,
  };
}

export function mapNamedRow(row: QueryResultRow) {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function querySongsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const result = await query("SELECT * FROM songs WHERE id = ANY($1::text[])", [ids]);
  return result.rows.map(mapSong);
}
