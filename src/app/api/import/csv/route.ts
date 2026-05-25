import { NextResponse } from "next/server";
import { z } from "zod";
import Papa from "papaparse";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { findOrCreateSong } from "@/lib/song-import";

type RawImportRow = Record<string, unknown>;

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
  opener_candidate: ["opener_candidate", "opener"],
  closer_candidate: ["closer_candidate", "closer"],
  lead_singer: ["lead_singer", "singer"],
  capo_or_tuning: ["capo_or_tuning", "capo", "tuning"],
  avoid_after: ["avoid_after"],
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
  notes: optionalText.pipe(z.string().max(2000).optional().nullable()),
  genre: optionalText.pipe(z.string().max(80).optional().nullable()),
  vibe: optionalText.pipe(z.string().max(120).optional().nullable()),
  crowd_score: optionalRating,
  danceability: optionalRating,
  vocal_difficulty: optionalRating,
  opener_candidate: optionalBool,
  closer_candidate: optionalBool,
  lead_singer: optionalText.pipe(z.string().max(120).optional().nullable()),
  capo_or_tuning: optionalText.pipe(z.string().max(120).optional().nullable()),
  avoid_after: optionalText.pipe(z.string().max(500).optional().nullable()),
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
    opener_candidate: canonicalValue(normalized, "opener_candidate"),
    closer_candidate: canonicalValue(normalized, "closer_candidate"),
    lead_singer: canonicalValue(normalized, "lead_singer"),
    capo_or_tuning: canonicalValue(normalized, "capo_or_tuning"),
    avoid_after: canonicalValue(normalized, "avoid_after"),
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

export async function POST(req: Request) {
  try {
    await requireUser();
    const text = await req.text();
    const parsed = parseImportRows(text);
    const ids: string[] = [];
    const errors = [...parsed.errors];
    const counts = { created: 0, matched: 0, updated: 0, duplicatesSkipped: 0, skipped: 0 };

    for (const [index, raw] of parsed.rows.entries()) {
      const mapped = canonicalizeRow(raw);
      if (!mapped.title || isSetMarker(mapped.title)) {
        counts.skipped += 1;
        continue;
      }

      const row = rowSchema.safeParse(mapped);
      if (!row.success) {
        counts.skipped += 1;
        errors.push(`Row ${index + 1}: ${row.error.issues.map((issue) => issue.message).join(", ")}`);
        continue;
      }

      const result = await findOrCreateSong({
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
        openerCandidate: row.data.opener_candidate ?? null,
        closerCandidate: row.data.closer_candidate ?? null,
        leadSinger: row.data.lead_singer ?? null,
        capoOrTuning: row.data.capo_or_tuning ?? null,
        avoidAfter: row.data.avoid_after ?? null,
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
    }

    return NextResponse.json({
      format: parsed.format,
      imported: ids.length,
      ids,
      created: counts.created,
      matched: counts.matched,
      updated: counts.updated,
      duplicatesSkipped: counts.duplicatesSkipped,
      skipped: counts.skipped,
      errors,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
