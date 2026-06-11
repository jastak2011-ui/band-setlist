import { NextResponse } from "next/server";
import { z } from "zod";
import Papa from "papaparse";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { findOrCreateSong, findOrCreateSongs, type SongImportInput } from "@/lib/song-import";
import { audienceAgeAppealArraySchema } from "@/lib/audience-age";
import { parseOnSongArchive } from "@/lib/onsong-import";

type RawImportRow = Record<string, unknown>;
type ImportDetail = {
  row: number;
  title: string | null;
  artist: string | null;
  status: "created" | "matched" | "updated" | "skipped";
  linked: boolean;
  reason: string;
  missingIdentityFields: string[];
};

const aliases = {
  title: ["title", "song", "song_title", "name"],
  artist: ["artist", "original_artist", "performer", "band"],
  key: ["key", "musical_key", "musicalkey"],
  bpm: ["bpm", "tempo"],
  duration_sec: ["duration", "length", "duration_sec", "length_sec"],
  energy: ["energy"],
  notes: ["notes", "comments"],
  genre: ["genre", "style"],
  vibe: ["vibe", "mood"],
  crowd_score: ["crowd_score", "crowd", "familiarity"],
  danceability: ["danceability", "dance"],
  vocal_difficulty: ["vocal_difficulty", "vocal"],
  singalong_score: ["singalong_score", "singalong", "sing_along"],
  peak_hour_score: ["peak_hour_score", "peak_hour", "peak"],
  transition_flexibility: ["transition_flexibility", "transition", "flexibility"],
  audience_age_appeal: ["audience_age_appeal", "age_appeal", "audience_age"],
  female_participation_score: ["female_participation_score", "female_participation", "female_engagement"],
  opener_candidate: ["opener_candidate", "opener"],
  closer_candidate: ["closer_candidate", "closer"],
  capo_or_tuning: ["capo_or_tuning", "capo", "tuning"],
  avoid_after: ["avoid_after"],
  onsong_song_id: ["onsong_song_id", "onsong_id", "onsong_songid"],
  onsong_filepath: ["onsong_filepath", "filepath", "onsong_file"],
  onsong_hash: ["onsong_hash", "hash"],
  onsong_content: ["onsong_content", "content"],
  onsong_lyrics: ["onsong_lyrics", "lyrics"],
  onsong_user: ["onsong_user"],
  onsong_provider_name: ["onsong_provider_name", "provider_name"],
  onsong_provider_uri: ["onsong_provider_uri", "provider_uri"],
} as const;

function emptyToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function parseDurationValue(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) return (parts[0] * 60) + parts[1];
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return value;
}

const optionalNumber = z.preprocess(emptyToNull, z.coerce.number().optional().nullable());
const optionalDuration = z.preprocess(parseDurationValue, optionalNumber).pipe(
  z.number().int().positive().max(36000).optional().nullable(),
);
const optionalRating = optionalNumber.pipe(
  z.number().min(0).max(10).transform((value) => (value > 1 ? value / 10 : value)).optional().nullable(),
);
const optionalText = z.preprocess(emptyToNull, z.string().optional().nullable());
const optionalSongText = optionalText.pipe(z.string().max(50000).optional().nullable());
const optionalTextArray = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}, audienceAgeAppealArraySchema.optional().nullable());
const optionalBool = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y", "x"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return value;
}, z.boolean().optional().nullable());

const rowSchema = z.object({
  title: z.string().min(1),
  artist: optionalText.pipe(z.string().max(200).optional().nullable()),
  bpm: optionalNumber.pipe(z.number().int().positive().max(400).optional().nullable()),
  key: optionalText.pipe(z.string().max(32).optional().nullable()),
  duration_sec: optionalDuration,
  energy: optionalRating,
  notes: optionalSongText,
  genre: optionalText.pipe(z.string().max(80).optional().nullable()),
  vibe: optionalText.pipe(z.string().max(120).optional().nullable()),
  crowd_score: optionalRating,
  danceability: optionalRating,
  vocal_difficulty: optionalRating,
  singalong_score: optionalRating,
  peak_hour_score: optionalRating,
  transition_flexibility: optionalRating,
  audience_age_appeal: optionalTextArray,
  female_participation_score: optionalRating,
  opener_candidate: optionalBool,
  closer_candidate: optionalBool,
  capo_or_tuning: optionalText.pipe(z.string().max(120).optional().nullable()),
  avoid_after: optionalText.pipe(z.string().max(500).optional().nullable()),
  onsong_song_id: optionalText.pipe(z.string().max(200).optional().nullable()),
  onsong_filepath: optionalText.pipe(z.string().max(500).optional().nullable()),
  onsong_hash: optionalNumber.pipe(z.number().int().optional().nullable()),
  onsong_content: optionalText.pipe(z.string().max(200000).optional().nullable()),
  onsong_lyrics: optionalText.pipe(z.string().max(200000).optional().nullable()),
  onsong_user: optionalText.pipe(z.string().max(200).optional().nullable()),
  onsong_provider_name: optionalText.pipe(z.string().max(200).optional().nullable()),
  onsong_provider_uri: optionalText.pipe(z.string().max(1000).optional().nullable()),
});

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function canonicalValue(raw: RawImportRow, field: keyof typeof aliases) {
  for (const alias of aliases[field]) {
    if (raw[alias] !== undefined) return raw[alias];
  }
  return undefined;
}

function canonicalizeRow(raw: RawImportRow) {
  const normalized: RawImportRow = {};
  for (const [key, value] of Object.entries(raw)) normalized[normalizeHeader(key)] = value;
  return {
    title: canonicalValue(normalized, "title"),
    artist: canonicalValue(normalized, "artist"),
    bpm: canonicalValue(normalized, "bpm"),
    key: canonicalValue(normalized, "key"),
    duration_sec: canonicalValue(normalized, "duration_sec"),
    energy: canonicalValue(normalized, "energy"),
    notes: canonicalValue(normalized, "notes"),
    genre: canonicalValue(normalized, "genre"),
    vibe: canonicalValue(normalized, "vibe"),
    crowd_score: canonicalValue(normalized, "crowd_score"),
    danceability: canonicalValue(normalized, "danceability"),
    vocal_difficulty: canonicalValue(normalized, "vocal_difficulty"),
    singalong_score: canonicalValue(normalized, "singalong_score"),
    peak_hour_score: canonicalValue(normalized, "peak_hour_score"),
    transition_flexibility: canonicalValue(normalized, "transition_flexibility"),
    audience_age_appeal: canonicalValue(normalized, "audience_age_appeal"),
    female_participation_score: canonicalValue(normalized, "female_participation_score"),
    opener_candidate: canonicalValue(normalized, "opener_candidate"),
    closer_candidate: canonicalValue(normalized, "closer_candidate"),
    capo_or_tuning: canonicalValue(normalized, "capo_or_tuning"),
    avoid_after: canonicalValue(normalized, "avoid_after"),
    onsong_song_id: canonicalValue(normalized, "onsong_song_id"),
    onsong_filepath: canonicalValue(normalized, "onsong_filepath"),
    onsong_hash: canonicalValue(normalized, "onsong_hash"),
    onsong_content: canonicalValue(normalized, "onsong_content"),
    onsong_lyrics: canonicalValue(normalized, "onsong_lyrics"),
    onsong_user: canonicalValue(normalized, "onsong_user"),
    onsong_provider_name: canonicalValue(normalized, "onsong_provider_name"),
    onsong_provider_uri: canonicalValue(normalized, "onsong_provider_uri"),
  };
}

function canonicalizeOnSongRow(raw: RawImportRow) {
  return {
    title: raw.title,
    artist: raw.artist,
    bpm: raw.bpm,
    key: raw.musicalKey,
    duration_sec: raw.durationSec,
    energy: raw.energy,
    notes: raw.notes,
    genre: raw.genre,
    vibe: raw.vibe,
    crowd_score: raw.crowdScore,
    danceability: raw.danceability,
    vocal_difficulty: raw.vocalDifficulty,
    singalong_score: raw.singalongScore,
    peak_hour_score: raw.peakHourScore,
    transition_flexibility: raw.transitionFlexibility,
    audience_age_appeal: raw.audienceAgeAppeal,
    female_participation_score: raw.femaleParticipationScore,
    opener_candidate: raw.openerCandidate,
    closer_candidate: raw.closerCandidate,
    capo_or_tuning: raw.capoOrTuning,
    avoid_after: raw.avoidAfter,
    onsong_song_id: raw.onsongSongId,
    onsong_filepath: raw.onsongFilepath,
    onsong_hash: raw.onsongHash,
    onsong_content: raw.onsongContent,
    onsong_lyrics: raw.onsongLyrics,
    onsong_user: raw.onsongUser,
    onsong_provider_name: raw.onsongProviderName,
    onsong_provider_uri: raw.onsongProviderUri,
  };
}

function isSetMarker(value: unknown) {
  return typeof value === "string" && /^\s*set\s*\d+\s*$/i.test(value);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parseHtmlRows(html: string) {
  const rows: RawImportRow[] = [];
  const rowMatches = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  let headers: string[] | null = null;

  for (const rowHtml of rowMatches) {
    const cells = Array.from(rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((match) => stripTags(match[1]));
    if (cells.length === 0) continue;
    const normalizedCells = cells.map(normalizeHeader);
    const looksLikeHeader = normalizedCells.some((cell) => aliases.title.includes(cell as never));
    if (!headers && looksLikeHeader) {
      headers = normalizedCells;
      continue;
    }
    if (!headers) continue;

    const row: RawImportRow = {};
    headers.forEach((header, index) => {
      if (header) row[header] = cells[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function parseCsvRows(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return { rows: parsed.data, errors: parsed.errors.map((error) => error.message) };
}

function parseImportRows(text: string) {
  if (/<table[\s>]/i.test(text) || /<tr[\s>]/i.test(text)) {
    return { format: "HTML", rows: parseHtmlRows(text), errors: [] as string[] };
  }
  const parsed = parseCsvRows(text);
  return { format: "CSV", ...parsed };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function importErrorResponse(prefix: string, error: unknown, status = 500) {
  const body: Record<string, unknown> = {
    ok: false,
    error: `${prefix}: ${errorMessage(error)}`,
  };
  if (process.env.NODE_ENV !== "production" && error instanceof Error && error.stack) body.stack = error.stack;
  return NextResponse.json(body, { status });
}

const identityFieldChecks = [
  ["onsong_song_id", "onsong_song_id"],
  ["onsong_filepath", "filepath"],
  ["onsong_hash", "hash"],
  ["onsong_content", "content"],
  ["onsong_lyrics", "lyrics"],
] as const;

function hasImportValue(value: unknown) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function missingIdentityFields(row: Record<string, unknown>) {
  return identityFieldChecks.filter(([field]) => !hasImportValue(row[field])).map(([, label]) => label);
}

function detailReason(status: ImportDetail["status"], linked: boolean, missing: string[]) {
  if (status === "created") return linked ? "Created new song and stored OnSong identity." : `Created new song, but OnSong identity is incomplete: missing ${missing.join(", ")}.`;
  if (status === "updated") return linked ? "Matched existing song and filled missing OnSong identity." : `Matched existing song, but identity is still incomplete: missing ${missing.join(", ")}.`;
  if (status === "matched") return linked
    ? "Matched existing song; OnSong identity was already present or no missing fields needed updates."
    : `Matched existing song but did not become OnSong Linked because identity is incomplete: missing ${missing.join(", ")}.`;
  return "Skipped.";
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = Buffer.from(await req.arrayBuffer());
    const filename = req.headers.get("x-import-filename") ?? "";
    const isArchiveUpload = filename.toLowerCase().endsWith(".archive") || body.subarray(0, 8).toString("ascii") === "bplist00";
    let parsed: { format: string; rows: RawImportRow[]; errors: string[] };
    try {
      if (isArchiveUpload) {
        const archive = parseOnSongArchive(body);
        parsed = { format: `OnSong ${archive.archiveType}`, rows: archive.songs, errors: [] };
      } else {
        parsed = parseImportRows(body.toString("utf8"));
      }
    } catch (error) {
      return importErrorResponse(isArchiveUpload ? "OnSong archive import failed" : "Song import failed", error, 400);
    }
    const ids: string[] = [];
    const errors = [...parsed.errors];
    const details: ImportDetail[] = [];
    const counts = { created: 0, matched: 0, updated: 0, duplicatesSkipped: 0, skipped: 0 };
    const pendingOnSongImports: Array<{ row: number; input: SongImportInput; mapped: Record<string, unknown> }> = [];

    for (const [index, raw] of parsed.rows.entries()) {
      const isOnSongImport = parsed.format.startsWith("OnSong");
      const mapped = isOnSongImport ? canonicalizeOnSongRow(raw) : canonicalizeRow(raw);
      if (!mapped.title || isSetMarker(mapped.title)) {
        counts.skipped += 1;
        details.push({
          row: index + 1,
          title: typeof mapped.title === "string" && mapped.title.trim() ? mapped.title : null,
          artist: typeof mapped.artist === "string" && mapped.artist.trim() ? mapped.artist : null,
          status: "skipped",
          linked: false,
          reason: !mapped.title ? "Skipped because no song title was found." : "Skipped because this row is a set marker, not a song.",
          missingIdentityFields: isOnSongImport ? missingIdentityFields(mapped) : [],
        });
        continue;
      }

      const row = rowSchema.safeParse(mapped);
      if (!row.success) {
        counts.skipped += 1;
        const reason = row.error.issues.map((issue) => issue.message).join(", ");
        errors.push(`Row ${index + 1}: ${reason}`);
        details.push({
          row: index + 1,
          title: typeof mapped.title === "string" && mapped.title.trim() ? mapped.title : null,
          artist: typeof mapped.artist === "string" && mapped.artist.trim() ? mapped.artist : null,
          status: "skipped",
          linked: false,
          reason,
          missingIdentityFields: isOnSongImport ? missingIdentityFields(mapped) : [],
        });
        continue;
      }

      const input: SongImportInput = {
        title: row.data.title,
        artist: row.data.artist || "Unknown Artist",
        bpm: row.data.bpm ?? null,
        musicalKey: row.data.key ?? null,
        durationSec: row.data.duration_sec ?? null,
        energy: row.data.energy ?? null,
        notes: row.data.notes ?? null,
        genre: row.data.genre ?? null,
        vibe: row.data.vibe ?? null,
        crowdScore: row.data.crowd_score ?? null,
        danceability: row.data.danceability ?? null,
        vocalDifficulty: row.data.vocal_difficulty ?? null,
        singalongScore: row.data.singalong_score ?? null,
        peakHourScore: row.data.peak_hour_score ?? null,
        transitionFlexibility: row.data.transition_flexibility ?? null,
        audienceAgeAppeal: row.data.audience_age_appeal ?? null,
        femaleParticipationScore: row.data.female_participation_score ?? null,
        openerCandidate: row.data.opener_candidate ?? null,
        closerCandidate: row.data.closer_candidate ?? null,
        capoOrTuning: row.data.capo_or_tuning ?? null,
        avoidAfter: row.data.avoid_after ?? null,
        onsongSongId: row.data.onsong_song_id ?? null,
        onsongFilepath: row.data.onsong_filepath ?? null,
        onsongHash: row.data.onsong_hash ?? null,
        onsongContent: row.data.onsong_content ?? null,
        onsongLyrics: row.data.onsong_lyrics ?? null,
        onsongUser: row.data.onsong_user ?? null,
        onsongProviderName: row.data.onsong_provider_name ?? null,
        onsongProviderUri: row.data.onsong_provider_uri ?? null,
      };

      if (isOnSongImport) {
        pendingOnSongImports.push({ row: index + 1, input, mapped });
        continue;
      }

      const result = await findOrCreateSong({
        ...input,
      });

      ids.push(result.song.id);
      if (result.status === "created") counts.created += 1;
      if (result.status === "updated") {
        counts.matched += 1;
        counts.updated += 1;
      }
      if (result.status === "matched") {
        counts.matched += 1;
        counts.duplicatesSkipped += 1;
      }
      const missing = isOnSongImport ? missingIdentityFields(mapped) : [];
      const linked = Boolean(result.song.onsongSongId);
      details.push({
        row: index + 1,
        title: row.data.title,
        artist: row.data.artist || "Unknown Artist",
        status: result.status === "created" ? "created" : result.status === "updated" ? "updated" : "matched",
        linked,
        reason: isOnSongImport ? detailReason(result.status === "created" ? "created" : result.status === "updated" ? "updated" : "matched", linked, missing) : `${result.status} song.`,
        missingIdentityFields: missing,
      });
    }

    if (pendingOnSongImports.length > 0) {
      let results;
      try {
        results = await findOrCreateSongs(pendingOnSongImports.map((item) => item.input));
      } catch (error) {
        return importErrorResponse("OnSong archive import failed while saving songs", error, 500);
      }
      for (const [index, item] of pendingOnSongImports.entries()) {
        const result = results[index];
        ids.push(result.song.id);
        if (result.status === "created") counts.created += 1;
        if (result.status === "updated") {
          counts.matched += 1;
          counts.updated += 1;
        }
        if (result.status === "matched") {
          counts.matched += 1;
          counts.duplicatesSkipped += 1;
        }
        const missing = missingIdentityFields(item.mapped);
        const linked = Boolean(result.song.onsongSongId);
        details.push({
          row: item.row,
          title: item.input.title,
          artist: item.input.artist || "Unknown Artist",
          status: result.status === "created" ? "created" : result.status === "updated" ? "updated" : "matched",
          linked,
          reason: detailReason(result.status === "created" ? "created" : result.status === "updated" ? "updated" : "matched", linked, missing),
          missingIdentityFields: missing,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      format: parsed.format,
      songsFound: parsed.rows.length,
      imported: ids.length,
      ids,
      created: counts.created,
      matched: counts.matched,
      updated: counts.updated,
      duplicatesSkipped: counts.duplicatesSkipped,
      skipped: counts.skipped,
      errors,
      details,
    });
  } catch (error) {
    try {
      return authErrorResponse(error);
    } catch {
      return importErrorResponse("Song import failed", error);
    }
  }
}
