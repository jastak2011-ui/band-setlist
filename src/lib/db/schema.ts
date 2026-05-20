import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const bands = sqliteTable("bands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const venues = sqliteTable("venues", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const songs = sqliteTable("songs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  bpm: integer("bpm"),
  musicalKey: text("musical_key"),
  durationSec: integer("duration_sec"),
  energy: real("energy"),
  notes: text("notes"),
  genre: text("genre"),
  vibe: text("vibe"),
  crowdScore: real("crowd_score"),
  danceability: real("danceability"),
  vocalDifficulty: real("vocal_difficulty"),
  openerCandidate: integer("opener_candidate", { mode: "boolean" }),
  closerCandidate: integer("closer_candidate", { mode: "boolean" }),
  leadSinger: text("lead_singer"),
  capoOrTuning: text("capo_or_tuning"),
  avoidAfter: text("avoid_after"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const setlists = sqliteTable("setlists", {
  id: text("id").primaryKey(),
  venueId: text("venue_id")
    .notNull()
    .references(() => venues.id, { onDelete: "cascade" }),
  bandId: text("band_id").references(() => bands.id, { onDelete: "set null" }),
  title: text("title"),
  performedAt: integer("performed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  notes: text("notes"),
});

export const setlistSets = sqliteTable("setlist_sets", {
  id: text("id").primaryKey(),
  setlistId: text("setlist_id")
    .notNull()
    .references(() => setlists.id, { onDelete: "cascade" }),
  setIndex: integer("set_index").notNull(),
});

export const setlistSetSongs = sqliteTable("setlist_set_songs", {
  id: text("id").primaryKey(),
  setId: text("set_id")
    .notNull()
    .references(() => setlistSets.id, { onDelete: "cascade" }),
  songId: text("song_id")
    .notNull()
    .references(() => songs.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
});
