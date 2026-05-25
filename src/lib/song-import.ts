import { mapSong, transaction, type DbSong } from "@/lib/db";
import { newId } from "@/lib/ids";

export type SongImportInput = {
  title: string;
  artist: string;
  bpm?: number | null;
  musicalKey?: string | null;
  durationSec?: number | null;
  energy?: number | null;
  notes?: string | null;
  genre?: string | null;
  vibe?: string | null;
  crowdScore?: number | null;
  danceability?: number | null;
  vocalDifficulty?: number | null;
  openerCandidate?: boolean | null;
  closerCandidate?: boolean | null;
  leadSinger?: string | null;
  capoOrTuning?: string | null;
  avoidAfter?: string | null;
};

export type SongImportResult = {
  song: DbSong;
  status: "created" | "matched" | "updated";
};

const importFields = [
  ["bpm", "bpm"],
  ["musicalKey", "musical_key"],
  ["durationSec", "duration_sec"],
  ["energy", "energy"],
  ["notes", "notes"],
  ["genre", "genre"],
  ["vibe", "vibe"],
  ["crowdScore", "crowd_score"],
  ["danceability", "danceability"],
  ["vocalDifficulty", "vocal_difficulty"],
  ["openerCandidate", "opener_candidate"],
  ["closerCandidate", "closer_candidate"],
  ["leadSinger", "lead_singer"],
  ["capoOrTuning", "capo_or_tuning"],
  ["avoidAfter", "avoid_after"],
] as const;

export function normalizeSongIdentity(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`'\u00b4]/g, "")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

export function sameSongIdentity(a: { title: string; artist: string }, b: { title: string; artist: string }) {
  return normalizeSongIdentity(a.title) === normalizeSongIdentity(b.title)
    && normalizeSongIdentity(a.artist) === normalizeSongIdentity(b.artist);
}

export async function findOrCreateSong(input: SongImportInput): Promise<SongImportResult> {
  const normalizedTitle = normalizeSongIdentity(input.title);
  const normalizedArtist = normalizeSongIdentity(input.artist);

  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [normalizedTitle, normalizedArtist]);

    const existingRows = await client.query("SELECT * FROM songs");
    const existing = existingRows.rows.find((row) => sameSongIdentity(input, { title: row.title, artist: row.artist }));

    if (existing) {
      const updates: string[] = [];
      const params: unknown[] = [existing.id];
      for (const [inputKey, column] of importFields) {
        const incoming = input[inputKey];
        if (hasValue(incoming) && !hasValue(existing[column])) {
          params.push(incoming);
          updates.push(`${column} = $${params.length}`);
        }
      }

      if (updates.length > 0) {
        const updated = await client.query(
          `UPDATE songs SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
          params,
        );
        return { song: mapSong(updated.rows[0]), status: "updated" };
      }

      return { song: mapSong(existing), status: "matched" };
    }

    const id = newId();
    const inserted = await client.query(
      `
      INSERT INTO songs (
        id, title, artist, bpm, musical_key, duration_sec, energy, notes, genre, vibe,
        crowd_score, danceability, vocal_difficulty, opener_candidate, closer_candidate,
        lead_singer, capo_or_tuning, avoid_after, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
      )
      RETURNING *
      `,
      [
        id,
        input.title.trim(),
        input.artist.trim(),
        input.bpm ?? null,
        input.musicalKey ?? null,
        input.durationSec ?? null,
        input.energy ?? null,
        input.notes ?? null,
        input.genre ?? null,
        input.vibe ?? null,
        input.crowdScore ?? null,
        input.danceability ?? null,
        input.vocalDifficulty ?? null,
        input.openerCandidate ?? null,
        input.closerCandidate ?? null,
        input.leadSinger ?? null,
        input.capoOrTuning ?? null,
        input.avoidAfter ?? null,
      ],
    );

    return { song: mapSong(inserted.rows[0]), status: "created" };
  });
}
