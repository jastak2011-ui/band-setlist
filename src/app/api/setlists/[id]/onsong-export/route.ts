import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { mapSetlist, query, querySongsByIds, type DbSong } from "@/lib/db";
import { createOnSongArchive, onSongArchiveFilename } from "@/lib/onsong-export";

type Params = { params: Promise<{ id: string }> };

const exportBody = z.object({
  sets: z.array(z.array(z.string()).min(0)).min(1).optional(),
});

export const dynamic = "force-dynamic";

async function loadSetlist(id: string) {
  const result = await query(
    `
    SELECT sl.*, v.name AS venue_name, b.name AS band_name
    FROM setlists sl
    LEFT JOIN venues v ON v.id = sl.venue_id
    LEFT JOIN bands b ON b.id = sl.band_id
    WHERE sl.id = $1
    `,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...mapSetlist(row),
    venueName: (row.venue_name as string | null) ?? "Not specified",
    bandName: (row.band_name as string | null) ?? null,
  };
}

async function loadSavedSetSongIds(id: string) {
  const setResult = await query("SELECT id, set_index FROM setlist_sets WHERE setlist_id = $1 ORDER BY set_index", [id]);
  const sets: string[][] = [];
  for (const set of setResult.rows) {
    const linkResult = await query("SELECT song_id FROM setlist_set_songs WHERE set_id = $1 ORDER BY position", [set.id]);
    sets.push(linkResult.rows.map((row) => row.song_id as string));
  }
  return sets;
}

async function hydrateSets(songIdSets: string[][]) {
  const ids = Array.from(new Set(songIdSets.flat()));
  const songs = await querySongsByIds(ids);
  const songMap = new Map(songs.map((song) => [song.id, song]));
  return songIdSets.map((songIds, index) => ({
    index: index + 1,
    songs: songIds.map((songId) => songMap.get(songId)).filter((song): song is DbSong => Boolean(song)),
  }));
}

export async function POST(req: Request, context: Params) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const setlist = await loadSetlist(id);
    if (!setlist) return privateJson({ error: "Not found" }, { status: 404 });
    await requireBandAccess(user, setlist.bandId);

    const json = await req.json().catch(() => ({}));
    const parsed = exportBody.safeParse(json);
    if (!parsed.success) return privateJson({ error: parsed.error.flatten() }, { status: 400 });

    const requestedSets = parsed.data.sets;
    const songIdSets = requestedSets && requestedSets.length > 0 ? requestedSets : await loadSavedSetSongIds(id);
    const sets = await hydrateSets(songIdSets);
    const archive = createOnSongArchive(setlist, sets);
    const filename = onSongArchiveFilename(setlist);

    return new Response(archive, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/octet-stream",
        "Vary": "Cookie",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
