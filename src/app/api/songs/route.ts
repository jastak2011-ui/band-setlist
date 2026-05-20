import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { songs } from "@/lib/db/schema";
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
  const db = getDb();
  const rows = await db.select().from(songs).orderBy(asc(songs.title));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = songInput.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const v = parsed.data;
  const id = newId();
  const now = new Date();
  const db = getDb();
  await db.insert(songs).values({
    id,
    title: v.title,
    artist: v.artist,
    bpm: v.bpm ?? null,
    musicalKey: v.musicalKey ?? null,
    durationSec: v.durationSec ?? null,
    energy: v.energy ?? null,
    notes: v.notes ?? null,
    genre: v.genre ?? null,
    vibe: v.vibe ?? null,
    crowdScore: v.crowdScore ?? null,
    danceability: v.danceability ?? null,
    vocalDifficulty: v.vocalDifficulty ?? null,
    openerCandidate: v.openerCandidate ?? null,
    closerCandidate: v.closerCandidate ?? null,
    leadSinger: v.leadSinger ?? null,
    capoOrTuning: v.capoOrTuning ?? null,
    avoidAfter: v.avoidAfter ?? null,
    createdAt: now,
  });
  const [row] = await db.select().from(songs).where(eq(songs.id, id));
  return NextResponse.json(row, { status: 201 });
}


