import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { mapSetlist, query, querySongsByIds, transaction } from "@/lib/db";
import { newId } from "@/lib/ids";

type Params = { params: Promise<{ id: string }> };

const setSongItem = z.union([
  z.string(),
  z.object({
    songId: z.string(),
    lockedWithNext: z.boolean().optional(),
  }),
]);

const patchBody = z.object({
  bandId: z.string().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  performedAt: z.string().nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  sets: z.array(z.array(setSongItem).min(0)).min(1).optional(),
});

function timesAreValid(startTime: string | null | undefined, endTime: string | null | undefined) {
  return !startTime || !endTime || startTime !== endTime;
}

export const dynamic = "force-dynamic";

async function getSetlistDetail(id: string) {
  const listResult = await query(
    `
    SELECT sl.*, v.name AS venue_name, v.venue_type, v.crowd_setup, b.name AS band_name
    FROM setlists sl
    JOIN venues v ON v.id = sl.venue_id
    LEFT JOIN bands b ON b.id = sl.band_id
    WHERE sl.id = $1
    `,
    [id],
  );
  const list = listResult.rows[0];
  if (!list) return null;

  const setResult = await query("SELECT * FROM setlist_sets WHERE setlist_id = $1 ORDER BY set_index", [id]);
  const ratingsResult = await query(
    `
    SELECT song_id, crowd_response_score, notes, updated_at
    FROM song_performance_ratings
    WHERE setlist_id = $1
    `,
    [id],
  );
  const ratingsBySong = new Map(ratingsResult.rows.map((row) => [row.song_id as string, {
    crowdResponseScore: row.crowd_response_score as number | null,
    notes: row.notes as string | null,
    updatedAt: row.updated_at as Date,
  }]));
  const outSets = [];
  for (const set of setResult.rows) {
    const linkResult = await query(
      "SELECT position, song_id, locked_with_next FROM setlist_set_songs WHERE set_id = $1 ORDER BY position",
      [set.id],
    );
    const ids = linkResult.rows.map((row) => row.song_id as string);
    const songRows = await querySongsByIds(ids);
    const songMap = new Map(songRows.map((row) => [row.id, row]));
    outSets.push({
      index: Number(set.set_index) + 1,
      songs: linkResult.rows
        .map((row) => {
          const song = songMap.get(row.song_id);
          return song ? { ...song, lockedWithNext: Boolean(row.locked_with_next), performanceRating: ratingsBySong.get(song.id) ?? null } : null;
        })
        .filter(Boolean),
    });
  }

  return {
    setlist: {
      ...mapSetlist(list),
      venueName: list.venue_name as string,
      venueType: (list.venue_type as string | null) ?? null,
      crowdSetup: (list.crowd_setup as string | null) ?? null,
      bandName: (list.band_name as string | null) ?? null,
    },
    sets: outSets,
  };
}

export async function GET(_req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const detail = await getSetlistDetail(id);
    if (!detail) return privateJson({ error: "Not found" }, { status: 404 });
    await requireBandAccess(user, detail.setlist.bandId);
    return privateJson(detail);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) return privateJson({ error: parsed.error.flatten() }, { status: 400 });

    const exists = await query("SELECT id, band_id, start_time, end_time FROM setlists WHERE id = $1", [id]);
    if (!exists.rows[0]) return privateJson({ error: "Not found" }, { status: 404 });
    await requireBandAccess(user, exists.rows[0].band_id);
    if (parsed.data.bandId !== undefined) await requireBandAccess(user, parsed.data.bandId);
    const currentStart = typeof exists.rows[0].start_time === "string" ? exists.rows[0].start_time.slice(0, 5) : null;
    const currentEnd = typeof exists.rows[0].end_time === "string" ? exists.rows[0].end_time.slice(0, 5) : null;
    const nextStart = parsed.data.startTime !== undefined ? parsed.data.startTime : currentStart;
    const nextEnd = parsed.data.endTime !== undefined ? parsed.data.endTime : currentEnd;
    if (!timesAreValid(nextStart, nextEnd)) {
      return privateJson({ error: "Start Time and End Time cannot be the same." }, { status: 400 });
    }

  await transaction(async (client) => {
    const updates: string[] = [];
    const params: unknown[] = [id];
    if (parsed.data.bandId !== undefined) {
      params.push(parsed.data.bandId);
      updates.push(`band_id = $${params.length}`);
    }
    if (parsed.data.title !== undefined) {
      params.push(parsed.data.title);
      updates.push(`title = $${params.length}`);
    }
    if (parsed.data.performedAt !== undefined) {
      params.push(parsed.data.performedAt ? new Date(parsed.data.performedAt) : null);
      updates.push(`performed_at = $${params.length}`);
    }
    if (parsed.data.startTime !== undefined) {
      params.push(parsed.data.startTime || null);
      updates.push(`start_time = $${params.length}`);
    }
    if (parsed.data.endTime !== undefined) {
      params.push(parsed.data.endTime || null);
      updates.push(`end_time = $${params.length}`);
    }
    if (updates.length > 0) {
      await client.query(`UPDATE setlists SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
    }

    if (parsed.data.sets) {
      const existingSets = await client.query("SELECT id FROM setlist_sets WHERE setlist_id = $1", [id]);
      const existingSetIds = existingSets.rows.map((row) => row.id as string);
      if (existingSetIds.length > 0) {
        await client.query("DELETE FROM setlist_set_songs WHERE set_id = ANY($1::text[])", [existingSetIds]);
      }
      await client.query("DELETE FROM setlist_sets WHERE setlist_id = $1", [id]);

      for (let i = 0; i < parsed.data.sets.length; i++) {
        const setId = newId();
        await client.query(
          "INSERT INTO setlist_sets (id, setlist_id, set_index, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
          [setId, id, i],
        );
        const songItems = parsed.data.sets[i];
        for (let p = 0; p < songItems.length; p++) {
          const item = songItems[p];
          const songId = typeof item === "string" ? item : item.songId;
          const lockedWithNext = typeof item === "string" ? false : Boolean(item.lockedWithNext) && p < songItems.length - 1;
          await client.query(
            "INSERT INTO setlist_set_songs (id, set_id, song_id, position, locked_with_next, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
            [newId(), setId, songId, p, lockedWithNext],
          );
        }
      }
      await client.query("UPDATE setlists SET updated_at = NOW() WHERE id = $1", [id]);
    }
  });

    const detail = await getSetlistDetail(id);
    return privateJson(detail ?? { ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await query("SELECT band_id FROM setlists WHERE id = $1", [id]);
    if (!existing.rows[0]) return privateJson({ error: "Not found" }, { status: 404 });
    await requireBandAccess(user, existing.rows[0].band_id);
    const result = await query("DELETE FROM setlists WHERE id = $1 RETURNING id", [id]);
    if (!result.rows[0]) return privateJson({ error: "Not found" }, { status: 404 });
    return privateJson({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
