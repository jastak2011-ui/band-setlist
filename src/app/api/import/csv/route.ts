import { NextResponse } from "next/server";
import { z } from "zod";
import Papa from "papaparse";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";

function emptyToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const optionalNumber = z.preprocess(emptyToNull, z.coerce.number().optional().nullable());
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
  artist: z.string().min(1),
  bpm: optionalNumber.pipe(z.number().int().positive().max(400).optional().nullable()),
  key: optionalText.pipe(z.string().max(32).optional().nullable()),
  duration_sec: optionalNumber.pipe(z.number().int().positive().max(36000).optional().nullable()),
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

export async function POST(req: Request) {
  const text = await req.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    return NextResponse.json({ error: parsed.errors.map((e) => e.message) }, { status: 400 });
  }
  const inserted: string[] = [];

  for (const raw of parsed.data) {
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      norm[k.trim().toLowerCase().replace(/\s+/g, "_")] = v;
    }
    const mapped = {
      title: norm.title ?? norm.song ?? norm.name,
      artist: norm.artist ?? norm.band,
      bpm: norm.bpm,
      key: norm.key ?? norm.musical_key ?? norm.musicalkey,
      duration_sec: norm.duration_sec ?? norm.duration ?? norm.length_sec,
      energy: norm.energy,
      notes: norm.notes,
      genre: norm.genre,
      vibe: norm.vibe,
      crowd_score: norm.crowd_score ?? norm.crowd ?? norm.familiarity,
      danceability: norm.danceability ?? norm.dance,
      vocal_difficulty: norm.vocal_difficulty ?? norm.vocal,
      opener_candidate: norm.opener_candidate ?? norm.opener,
      closer_candidate: norm.closer_candidate ?? norm.closer,
      lead_singer: norm.lead_singer ?? norm.singer,
      capo_or_tuning: norm.capo_or_tuning ?? norm.capo ?? norm.tuning,
      avoid_after: norm.avoid_after,
    };
    const r = rowSchema.safeParse(mapped);
    if (!r.success) continue;
    const id = newId();
    await query(
      `
      INSERT INTO songs (
        id, title, artist, bpm, musical_key, duration_sec, energy, notes, genre, vibe,
        crowd_score, danceability, vocal_difficulty, opener_candidate, closer_candidate,
        lead_singer, capo_or_tuning, avoid_after, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
      )
      `,
      [
        id,
        r.data.title,
        r.data.artist,
        r.data.bpm ?? null,
        r.data.key ?? null,
        r.data.duration_sec ?? null,
        r.data.energy ?? null,
        r.data.notes ?? null,
        r.data.genre ?? null,
        r.data.vibe ?? null,
        r.data.crowd_score ?? null,
        r.data.danceability ?? null,
        r.data.vocal_difficulty ?? null,
        r.data.opener_candidate ?? null,
        r.data.closer_candidate ?? null,
        r.data.lead_singer ?? null,
        r.data.capo_or_tuning ?? null,
        r.data.avoid_after ?? null,
      ],
    );
    inserted.push(id);
  }

  return NextResponse.json({ imported: inserted.length, ids: inserted });
}






