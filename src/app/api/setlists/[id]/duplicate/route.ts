import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { newId } from "@/lib/ids";

type Params = { params: Promise<{ id: string }> };

const body = z.object({ bandId: z.string().nullable().optional() });

export const dynamic = "force-dynamic";

export async function POST(req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const json = await req.json().catch(() => ({}));
    const parsed = body.safeParse(json);
    if (!parsed.success) return privateJson({ error: parsed.error.flatten() }, { status: 400 });

    const sourceResult = await query("SELECT * FROM setlists WHERE id = $1", [id]);
    const source = sourceResult.rows[0];
    if (!source) return privateJson({ error: "Not found" }, { status: 404 });
    await requireBandAccess(user, source.band_id);
    if (parsed.data.bandId !== undefined) await requireBandAccess(user, parsed.data.bandId);

  const newSetlistId = newId();
  await transaction(async (client) => {
    await client.query(
      `
      INSERT INTO setlists (id, venue_id, band_id, title, performed_at, created_at, updated_at, notes)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)
      `,
      [
        newSetlistId,
        source.venue_id,
        parsed.data.bandId !== undefined ? parsed.data.bandId : source.band_id,
        source.title ? `${source.title} (Copy)` : "Setlist copy",
        source.performed_at,
        source.notes,
      ],
    );

    const sourceSets = await client.query("SELECT * FROM setlist_sets WHERE setlist_id = $1 ORDER BY set_index", [id]);
    for (const sourceSet of sourceSets.rows) {
      const newSetId = newId();
      await client.query(
        "INSERT INTO setlist_sets (id, setlist_id, set_index, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
        [newSetId, newSetlistId, sourceSet.set_index],
      );
      const links = await client.query("SELECT * FROM setlist_set_songs WHERE set_id = $1 ORDER BY position", [sourceSet.id]);
      for (const link of links.rows) {
        await client.query(
          "INSERT INTO setlist_set_songs (id, set_id, song_id, position, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
          [newId(), newSetId, link.song_id, link.position],
        );
      }
    }
  });

    return privateJson({ id: newSetlistId }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
