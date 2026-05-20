import { NextResponse } from "next/server";
import { and, desc, eq, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setlistSetSongs, setlistSets, setlists } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

const saveBody = z.object({
  venueId: z.string(),
  bandId: z.string().optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  performedAt: z.string().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  sets: z.array(z.array(z.string())).min(1),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const venueId = url.searchParams.get("venueId");
  const bandId = url.searchParams.get("bandId");
  const db = getDb();
  const filters: SQLWrapper[] = [];
  if (venueId) filters.push(eq(setlists.venueId, venueId));
  if (bandId) filters.push(eq(setlists.bandId, bandId));

  const query = db.select().from(setlists);
  const rows = filters.length > 0
    ? await query.where(and(...filters)).orderBy(desc(setlists.createdAt))
    : await query.orderBy(desc(setlists.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = saveBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const setlistId = newId();
  const now = new Date();
  const performedAt =
    parsed.data.performedAt && parsed.data.performedAt.length > 0
      ? new Date(parsed.data.performedAt)
      : null;

  await db.insert(setlists).values({
    id: setlistId,
    venueId: parsed.data.venueId,
    bandId: parsed.data.bandId ?? null,
    title: parsed.data.title ?? null,
    performedAt,
    createdAt: now,
    notes: parsed.data.notes ?? null,
  });

  for (let i = 0; i < parsed.data.sets.length; i++) {
    const setId = newId();
    await db.insert(setlistSets).values({
      id: setId,
      setlistId,
      setIndex: i,
    });
    const songIds = parsed.data.sets[i];
    for (let p = 0; p < songIds.length; p++) {
      await db.insert(setlistSetSongs).values({
        id: newId(),
        setId,
        songId: songIds[p],
        position: p,
      });
    }
  }

  return NextResponse.json({ id: setlistId }, { status: 201 });
}
