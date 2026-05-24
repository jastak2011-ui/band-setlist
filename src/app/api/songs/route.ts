import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { mapSong, query } from "@/lib/db";
import { newId } from "@/lib/ids";

const rating = z.number().min(0).max(10).transform((value) => (value > 1 ? value / 10 : value));

const songInput = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  bpm: z.number().int().positive().max(400).optional().nullable(),
  musicalKey: z.string().max(32).optional().nullable(),
  durationSec: z.number().int().positive().max(36000).optional().nullable(),
  energy: rating.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  genre: z.string().max(80).optional().nullable(),
  vibe: z.string().max(120).optional().nullable(),
  crowdScore: rating.optional().nullable(),
  danceability: rating.optional().nullable(),
  vocalDifficulty: rating.optional().nullable(),
  openerCandidate: z.boolean().optional().nullable(),
  closerCandidate: z.boolean().optional().nullable(),
  leadSinger: z.string().max(120).optional().nullable(),
  capoOrTuning: z.string().max(120).optional().nullable(),
  avoidAfter: z.string().max(500).optional().nullable(),
});

export async function GET() {
  try {
    await requireUser();
    const result = await query("SELECT * FROM songs ORDER BY lower(title), lower(artist)");
    return NextResponse.json(result.rows.map(mapSong));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const json = await req.json();
    const parsed = songInput.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

  const v = parsed.data;
  const id = newId();
  const result = await query(
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
      v.title,
      v.artist,
      v.bpm ?? null,
      v.musicalKey ?? null,
      v.durationSec ?? null,
      v.energy ?? null,
      v.notes ?? null,
      v.genre ?? null,
      v.vibe ?? null,
      v.crowdScore ?? null,
      v.danceability ?? null,
      v.vocalDifficulty ?? null,
      v.openerCandidate ?? null,
      v.closerCandidate ?? null,
      v.leadSinger ?? null,
      v.capoOrTuning ?? null,
      v.avoidAfter ?? null,
    ],
  );
    return NextResponse.json(mapSong(result.rows[0]), { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
