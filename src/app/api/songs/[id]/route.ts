import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { songs } from "@/lib/db/schema";

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

export async function PATCH(req: Request, context: Params) {
  const { id } = await context.params;
  const json = await req.json();
  const parsed = patch.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const db = getDb();
  const u = parsed.data;
  const set: Record<string, unknown> = {};
  if (u.title !== undefined) set.title = u.title;
  if (u.artist !== undefined) set.artist = u.artist;
  if (u.bpm !== undefined) set.bpm = u.bpm;
  if (u.musicalKey !== undefined) set.musicalKey = u.musicalKey;
  if (u.durationSec !== undefined) set.durationSec = u.durationSec;
  if (u.energy !== undefined) set.energy = u.energy;
  if (u.notes !== undefined) set.notes = u.notes;
  if (u.genre !== undefined) set.genre = u.genre;
  if (u.vibe !== undefined) set.vibe = u.vibe;
  if (u.crowdScore !== undefined) set.crowdScore = u.crowdScore;
  if (u.danceability !== undefined) set.danceability = u.danceability;
  if (u.vocalDifficulty !== undefined) set.vocalDifficulty = u.vocalDifficulty;
  if (u.openerCandidate !== undefined) set.openerCandidate = u.openerCandidate;
  if (u.closerCandidate !== undefined) set.closerCandidate = u.closerCandidate;
  if (u.leadSinger !== undefined) set.leadSinger = u.leadSinger;
  if (u.capoOrTuning !== undefined) set.capoOrTuning = u.capoOrTuning;
  if (u.avoidAfter !== undefined) set.avoidAfter = u.avoidAfter;
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  await db.update(songs).set(set as never).where(eq(songs.id, id));
  const [row] = await db.select().from(songs).where(eq(songs.id, id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, context: Params) {
  const { id } = await context.params;
  const db = getDb();
  await db.delete(songs).where(eq(songs.id, id));
  return NextResponse.json({ ok: true });
}


