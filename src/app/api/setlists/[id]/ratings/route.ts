import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";

type Params = { params: Promise<{ id: string }> };

const body = z.object({
  songId: z.string().min(1),
  crowdResponseScore: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const dynamic = "force-dynamic";

export async function PUT(req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const json = await req.json();
    const parsed = body.safeParse(json);
    if (!parsed.success) return privateJson({ error: parsed.error.flatten() }, { status: 400 });

    const setlistResult = await query(
      "SELECT id, band_id, venue_id, performed_at FROM setlists WHERE id = $1",
      [id],
    );
    const setlist = setlistResult.rows[0];
    if (!setlist) return privateJson({ error: "Setlist not found" }, { status: 404 });
    await requireBandAccess(user, setlist.band_id);

    const songInSet = await query(
      `
      SELECT 1
      FROM setlist_sets ss
      JOIN setlist_set_songs sss ON sss.set_id = ss.id
      WHERE ss.setlist_id = $1 AND sss.song_id = $2
      LIMIT 1
      `,
      [id, parsed.data.songId],
    );
    if (!songInSet.rows[0]) return privateJson({ error: "Song is not in this setlist." }, { status: 400 });

    const notes = parsed.data.notes?.trim() || null;
    const score = parsed.data.crowdResponseScore ?? null;

    const result = await query(
      `
      INSERT INTO song_performance_ratings (
        id, song_id, setlist_id, band_id, venue_id, performance_date,
        crowd_response_score, notes, created_by, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (song_id, setlist_id) DO UPDATE SET
        band_id = EXCLUDED.band_id,
        venue_id = EXCLUDED.venue_id,
        performance_date = EXCLUDED.performance_date,
        crowd_response_score = EXCLUDED.crowd_response_score,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING song_id, crowd_response_score, notes, updated_at
      `,
      [
        newId(),
        parsed.data.songId,
        id,
        setlist.band_id ?? null,
        setlist.venue_id,
        setlist.performed_at ?? null,
        score,
        notes,
        user.id,
      ],
    );

    const row = result.rows[0];
    return privateJson({
      songId: row.song_id,
      crowdResponseScore: row.crowd_response_score,
      notes: row.notes,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
