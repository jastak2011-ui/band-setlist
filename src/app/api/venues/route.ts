import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { venues } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

const body = z.object({ name: z.string().min(1).max(200) });

export async function GET() {
  const db = getDb();
  const rows = await db.select().from(venues).orderBy(asc(venues.name));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const id = newId();
  const now = new Date();
  const db = getDb();
  await db.insert(venues).values({ id, name: parsed.data.name, createdAt: now });
  return NextResponse.json({ id, name: parsed.data.name, createdAt: now }, { status: 201 });
}
