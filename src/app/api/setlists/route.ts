import { NextResponse } from "next/server";
import { z } from "zod";
import { mapSetlist, query, transaction } from "@/lib/db";
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
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (venueId) {
    params.push(venueId);
    clauses.push(`sl.venue_id = $${params.length}`);
  }
  if (bandId) {
    params.push(bandId);
    clauses.push(`sl.band_id = $${params.length}`);
  }

  const result = await query(
    `
    SELECT
      sl.*,
      CASE
        WHEN COUNT(DISTINCT ss.id) > 0 THEN COUNT(DISTINCT ss.id)
        WHEN COUNT(sss.id) FILTER (WHERE s.id IS NULL OR NOT (s.title ~* '^\\s*set\\s*[0-9]+\\s*$')) > 0 THEN 1
        ELSE 0
      END AS set_count,
      COUNT(sss.id) FILTER (WHERE s.id IS NULL OR NOT (s.title ~* '^\\s*set\\s*[0-9]+\\s*$')) AS song_count
    FROM setlists sl
    LEFT JOIN setlist_sets ss ON ss.setlist_id = sl.id
    LEFT JOIN setlist_set_songs sss ON sss.set_id = ss.id
    LEFT JOIN songs s ON s.id = sss.song_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    GROUP BY sl.id, sl.venue_id, sl.band_id, sl.title, sl.performed_at, sl.created_at, sl.updated_at, sl.notes
    ORDER BY sl.performed_at DESC NULLS LAST, sl.updated_at DESC, sl.created_at DESC
    `,
    params,
  );
  return NextResponse.json(result.rows.map((row) => ({
    ...mapSetlist(row),
    setCount: Number(row.set_count ?? 0),
    songCount: Number(row.song_count ?? 0),
  })));
}

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = saveBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const setlistId = newId();
  const performedAt = parsed.data.performedAt && parsed.data.performedAt.length > 0 ? new Date(parsed.data.performedAt) : null;

  await transaction(async (client) => {
    await client.query(
      `
      INSERT INTO setlists (id, venue_id, band_id, title, performed_at, created_at, updated_at, notes)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)
      `,
      [setlistId, parsed.data.venueId, parsed.data.bandId ?? null, parsed.data.title ?? null, performedAt, parsed.data.notes ?? null],
    );

    for (let i = 0; i < parsed.data.sets.length; i++) {
      const setId = newId();
      await client.query(
        "INSERT INTO setlist_sets (id, setlist_id, set_index, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
        [setId, setlistId, i],
      );
      const songIds = parsed.data.sets[i];
      for (let p = 0; p < songIds.length; p++) {
        await client.query(
          "INSERT INTO setlist_set_songs (id, set_id, song_id, position, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
          [newId(), setId, songIds[p], p],
        );
      }
    }
  });

  return NextResponse.json({ id: setlistId }, { status: 201 });
}
