import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { mapSong, query } from "@/lib/db";

const rating = z.number().min(0).max(10).transform((value) => (value > 1 ? value / 10 : value));

const patch = z.object({
  title: z.string().min(1).optional(),
  artist: z.string().min(1).optional(),
  bpm: z.number().int().positive().max(400).nullable().optional(),
  musicalKey: z.string().max(32).nullable().optional(),
  durationSec: z.number().int().positive().max(36000).nullable().optional(),
  energy: rating.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  genre: z.string().max(80).nullable().optional(),
  vibe: z.string().max(120).nullable().optional(),
  crowdScore: rating.nullable().optional(),
  danceability: rating.nullable().optional(),
  vocalDifficulty: rating.nullable().optional(),
  openerCandidate: z.boolean().nullable().optional(),
  closerCandidate: z.boolean().nullable().optional(),
  leadSinger: z.string().max(120).nullable().optional(),
  capoOrTuning: z.string().max(120).nullable().optional(),
  avoidAfter: z.string().max(500).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

const columnMap: Record<string, string> = {
  title: "title",
  artist: "artist",
  bpm: "bpm",
  musicalKey: "musical_key",
  durationSec: "duration_sec",
  energy: "energy",
  notes: "notes",
  genre: "genre",
  vibe: "vibe",
  crowdScore: "crowd_score",
  danceability: "danceability",
  vocalDifficulty: "vocal_difficulty",
  openerCandidate: "opener_candidate",
  closerCandidate: "closer_candidate",
  leadSinger: "lead_singer",
  capoOrTuning: "capo_or_tuning",
  avoidAfter: "avoid_after",
};

export async function PATCH(req: Request, context: Params) {
  try {
    await requireUser();
    const { id } = await context.params;
    const json = await req.json();
    const parsed = patch.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const assignments = entries.map(([key], index) => `${columnMap[key]} = $${index + 2}`);
  const values = entries.map(([, value]) => value);
  const result = await query(
    `UPDATE songs SET ${assignments.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
    if (!result.rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(mapSong(result.rows[0]));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_req: Request, context: Params) {
  try {
    await requireUser();
    const { id } = await context.params;
    await query("DELETE FROM songs WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
