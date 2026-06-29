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
  singalongScore?: number | null;
  peakHourScore?: number | null;
  transitionFlexibility?: number | null;
  audienceAgeAppeal?: string[] | null;
  femaleParticipationScore?: number | null;
  openerCandidate?: boolean | null;
  closerCandidate?: boolean | null;
  capoOrTuning?: string | null;
  avoidAfter?: string | null;
  onsongSongId?: string | null;
  onsongFilepath?: string | null;
  onsongHash?: string | number | null;
  onsongContent?: string | null;
  onsongLyrics?: string | null;
  onsongUser?: string | null;
  onsongProviderName?: string | null;
  onsongProviderUri?: string | null;
};

export type SongImportResult = {
  song: DbSong | null;
  status: "created" | "matched" | "updated" | "skipped";
  input: SongImportInput;
  reason?: string;
};

export type SongImportOptions = {
  matchExisting?: boolean;
  importMissing?: boolean;
  updateExistingMetadata?: boolean;
  preserveBandSetlistMetadata?: boolean;
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
  ["singalongScore", "singalong_score"],
  ["peakHourScore", "peak_hour_score"],
  ["transitionFlexibility", "transition_flexibility"],
  ["audienceAgeAppeal", "audience_age_appeal"],
  ["femaleParticipationScore", "female_participation_score"],
  ["openerCandidate", "opener_candidate"],
  ["closerCandidate", "closer_candidate"],
  ["capoOrTuning", "capo_or_tuning"],
  ["avoidAfter", "avoid_after"],
  ["onsongSongId", "onsong_song_id"],
  ["onsongFilepath", "onsong_filepath"],
  ["onsongHash", "onsong_hash"],
  ["onsongContent", "onsong_content"],
  ["onsongLyrics", "onsong_lyrics"],
  ["onsongUser", "onsong_user"],
  ["onsongProviderName", "onsong_provider_name"],
  ["onsongProviderUri", "onsong_provider_uri"],
] as const;

const onsongIdentityFields = new Set<string>([
  "onsongSongId",
  "onsongFilepath",
  "onsongHash",
  "onsongContent",
  "onsongLyrics",
  "onsongUser",
  "onsongProviderName",
  "onsongProviderUri",
]);

const safeOnSongMetadataFields = new Set<string>(["title", "artist", "musicalKey", "bpm", "durationSec"]);

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

function normalizedOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function sameOnSongHash(a: unknown, b: unknown) {
  if (!hasValue(a) || !hasValue(b)) return false;
  return String(a) === String(b);
}

function findExistingSong(existingSongs: Record<string, unknown>[], input: SongImportInput) {
  const onsongSongId = normalizedOptional(input.onsongSongId);
  if (onsongSongId) {
    const existing = existingSongs.find((row) => normalizedOptional(row.onsong_song_id) === onsongSongId);
    if (existing) return existing;
  }

  const filepath = normalizedOptional(input.onsongFilepath);
  if (filepath) {
    const existing = existingSongs.find((row) => normalizedOptional(row.onsong_filepath) === filepath);
    if (existing) return existing;
  }

  if (hasValue(input.onsongHash)) {
    const existing = existingSongs.find((row) => sameOnSongHash(row.onsong_hash, input.onsongHash));
    if (existing) return existing;
  }

  return existingSongs.find((row) => sameSongIdentity(input, { title: String(row.title ?? ""), artist: String(row.artist ?? "") }));
}

export async function findOrCreateSong(input: SongImportInput, options?: SongImportOptions): Promise<SongImportResult> {
  return (await findOrCreateSongs([input], options))[0];
}

export async function findOrCreateSongs(inputs: SongImportInput[], options: SongImportOptions = {}): Promise<SongImportResult[]> {
  if (inputs.length === 0) return [];
  const useLegacyUpdateBehavior = Object.keys(options).length === 0;
  const matchExisting = options.matchExisting ?? true;
  const importMissing = options.importMissing ?? true;
  const updateExistingMetadata = options.updateExistingMetadata ?? true;
  const preserveBandSetlistMetadata = options.preserveBandSetlistMetadata ?? true;

  return transaction(async (client) => {
    const existingRows = await client.query("SELECT * FROM songs");
    const existingSongs = [...existingRows.rows];
    const results: SongImportResult[] = [];

    for (const input of inputs) {
      const normalizedTitle = normalizeSongIdentity(input.title);
      const normalizedArtist = normalizeSongIdentity(input.artist);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [normalizedTitle, normalizedArtist]);

      const existing = matchExisting ? findExistingSong(existingSongs, input) : null;

      if (existing) {
        const updates: string[] = [];
        const params: unknown[] = [existing.id];
        for (const [inputKey, column] of importFields) {
          if (!useLegacyUpdateBehavior) {
            if (!onsongIdentityFields.has(inputKey) && !updateExistingMetadata) continue;
            if (updateExistingMetadata && !onsongIdentityFields.has(inputKey) && !safeOnSongMetadataFields.has(inputKey)) continue;
          }
          const incoming = input[inputKey];
          const shouldUpdate = hasValue(incoming)
            && (preserveBandSetlistMetadata || onsongIdentityFields.has(inputKey) ? !hasValue(existing[column]) : true);
          if (shouldUpdate) {
            params.push(incoming);
            updates.push(`${column} = $${params.length}`);
          }
        }

        if (updateExistingMetadata) {
          const directFields = [
            ["title", "title"],
            ["artist", "artist"],
          ] as const;
          for (const [inputKey, column] of directFields) {
            const incoming = input[inputKey]?.trim();
            const shouldUpdate = hasValue(incoming) && (preserveBandSetlistMetadata ? !hasValue(existing[column]) : true);
            if (shouldUpdate) {
              params.push(incoming);
              updates.push(`${column} = $${params.length}`);
            }
          }
        }

        if (updates.length > 0) {
          const updated = await client.query(
            `UPDATE songs SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
            params,
          );
          Object.assign(existing, updated.rows[0]);
          results.push({ song: mapSong(updated.rows[0]), status: "updated", input });
          continue;
        }

        results.push({ song: mapSong(existing), status: "matched", input });
        continue;
      }

      if (!importMissing) {
        results.push({ song: null, status: "skipped", input, reason: "No matching song found and Import missing songs is off." });
        continue;
      }

      const id = newId();
      const inserted = await client.query(
        `
        INSERT INTO songs (
          id, title, artist, bpm, musical_key, duration_sec, energy, notes, genre, vibe,
          crowd_score, danceability, vocal_difficulty, opener_candidate, closer_candidate,
          singalong_score, peak_hour_score, transition_flexibility, audience_age_appeal, female_participation_score,
          singalong_score_source, peak_hour_score_source, transition_flexibility_source, audience_age_appeal_source, female_participation_score_source,
          capo_or_tuning, avoid_after, onsong_song_id, onsong_filepath, onsong_hash, onsong_content, onsong_lyrics,
          onsong_user, onsong_provider_name, onsong_provider_uri, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, NOW(), NOW()
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
          input.singalongScore ?? null,
          input.peakHourScore ?? null,
          input.transitionFlexibility ?? null,
          input.audienceAgeAppeal ?? null,
          input.femaleParticipationScore ?? null,
          input.singalongScore == null ? null : "manual",
          input.peakHourScore == null ? null : "manual",
          input.transitionFlexibility == null ? null : "manual",
          input.audienceAgeAppeal?.length ? "manual" : null,
          input.femaleParticipationScore == null ? null : "manual",
          input.capoOrTuning ?? null,
          input.avoidAfter ?? null,
          input.onsongSongId ?? null,
          input.onsongFilepath ?? null,
          input.onsongHash ?? null,
          input.onsongContent ?? null,
          input.onsongLyrics ?? null,
          input.onsongUser ?? null,
          input.onsongProviderName ?? null,
          input.onsongProviderUri ?? null,
        ],
      );

      existingSongs.push(inserted.rows[0]);
      results.push({ song: mapSong(inserted.rows[0]), status: "created", input });
    }

    return results;
  });
}
