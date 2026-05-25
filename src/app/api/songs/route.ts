import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { mapSong, query } from "@/lib/db";
import { findOrCreateSong } from "@/lib/song-import";

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

    const result = await findOrCreateSong(parsed.data);
    return NextResponse.json({ ...result.song, importStatus: result.status }, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
