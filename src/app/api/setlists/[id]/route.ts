import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setlistSetSongs, setlistSets, setlists, songs } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

type Params = { params: Promise<{ id: string }> };

const patchBody = z.object({
  bandId: z.string().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  performedAt: z.string().nullable().optional(),
  sets: z.array(z.array(z.string()).min(0)).min(1).optional(),
});

async function getSetlistDetail(id: string) {
  const db = getDb();
  const [list] = await db.select().from(setlists).where(eq(setlists.id, id));
  if (!list) return null;

  const sets = await db.select().from(setlistSets).where(eq(setlistSets.setlistId, id)).orderBy(asc(setlistSets.setIndex));
  const outSets = [];
  for (const s of sets) {
    const links = await db
      .select({ position: setlistSetSongs.position, songId: setlistSetSongs.songId })
      .from(setlistSetSongs)
      .where(eq(setlistSetSongs.setId, s.id))
      .orderBy(asc(setlistSetSongs.position));

    const ids = links.map((l) => l.songId);
    const songRows = ids.length === 0 ? [] : await db.select().from(songs).where(inArray(songs.id, ids));
    const songMap = new Map(songRows.map((r) => [r.id, r]));
    outSets.push({ index: s.setIndex + 1, songs: links.map((l) => songMap.get(l.songId)).filter(Boolean) });
  }

  return { setlist: list, sets: outSets };
}

export async function GET(_req: Request, context: Params) {
  const { id } = await context.params;
  const detail = await getSetlistDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, context: Params) {
  const { id } = await context.params;
  const json = await req.json();
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();
  const [list] = await db.select().from(setlists).where(eq(setlists.id, id));
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: Partial<typeof setlists.$inferInsert> = {};
  if (parsed.data.bandId !== undefined) updates.bandId = parsed.data.bandId;
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.performedAt !== undefined) {
    updates.performedAt = parsed.data.performedAt ? new Date(parsed.data.performedAt) : null;
  }
  if (Object.keys(updates).length > 0) {
    await db.update(setlists).set(updates).where(eq(setlists.id, id));
  }

  if (parsed.data.sets) {
    const existingSets = await db.select().from(setlistSets).where(eq(setlistSets.setlistId, id));
    const existingSetIds = existingSets.map((set) => set.id);
    if (existingSetIds.length > 0) await db.delete(setlistSetSongs).where(inArray(setlistSetSongs.setId, existingSetIds));
    await db.delete(setlistSets).where(eq(setlistSets.setlistId, id));

    for (let i = 0; i < parsed.data.sets.length; i++) {
      const setId = newId();
      await db.insert(setlistSets).values({ id: setId, setlistId: id, setIndex: i });
      const songIds = parsed.data.sets[i];
      for (let p = 0; p < songIds.length; p++) {
        await db.insert(setlistSetSongs).values({ id: newId(), setId, songId: songIds[p], position: p });
      }
    }
  }

  const detail = await getSetlistDetail(id);
  return NextResponse.json(detail ?? { ok: true });
}
export async function DELETE(_req: Request, context: Params) {
  const { id } = await context.params;
  const db = getDb();
  const [list] = await db.select().from(setlists).where(eq(setlists.id, id));
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existingSets = await db.select().from(setlistSets).where(eq(setlistSets.setlistId, id));
  const existingSetIds = existingSets.map((set) => set.id);
  if (existingSetIds.length > 0) await db.delete(setlistSetSongs).where(inArray(setlistSetSongs.setId, existingSetIds));
  await db.delete(setlistSets).where(eq(setlistSets.setlistId, id));
  await db.delete(setlists).where(eq(setlists.id, id));

  return NextResponse.json({ ok: true });
}