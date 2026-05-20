import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setlistSetSongs, setlistSets, setlists } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

type Params = { params: Promise<{ id: string }> };

const body = z.object({ bandId: z.string().nullable().optional() });

export async function POST(req: Request, context: Params) {
  const { id } = await context.params;
  const json = await req.json().catch(() => ({}));
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();
  const [source] = await db.select().from(setlists).where(eq(setlists.id, id));
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const newSetlistId = newId();
  await db.insert(setlists).values({
    id: newSetlistId,
    venueId: source.venueId,
    bandId: parsed.data.bandId !== undefined ? parsed.data.bandId : source.bandId,
    title: source.title ? `${source.title} (Copy)` : "Setlist copy",
    performedAt: source.performedAt,
    createdAt: now,
    notes: source.notes,
  });

  const sourceSets = await db.select().from(setlistSets).where(eq(setlistSets.setlistId, id)).orderBy(asc(setlistSets.setIndex));
  for (const sourceSet of sourceSets) {
    const newSetId = newId();
    await db.insert(setlistSets).values({ id: newSetId, setlistId: newSetlistId, setIndex: sourceSet.setIndex });
    const links = await db
      .select()
      .from(setlistSetSongs)
      .where(eq(setlistSetSongs.setId, sourceSet.id))
      .orderBy(asc(setlistSetSongs.position));
    for (const link of links) {
      await db.insert(setlistSetSongs).values({ id: newId(), setId: newSetId, songId: link.songId, position: link.position });
    }
  }

  return NextResponse.json({ id: newSetlistId }, { status: 201 });
}