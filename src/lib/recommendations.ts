import { query } from "./db";

const DEFAULT_RECENT = 10;

/**
 * Count how often each song appeared in the last N setlists for a venue,
 * optionally scoped to the selected band.
 */
export async function getVenueSongPlayCounts(
  venueId: string,
  bandId?: string,
  recentSetlists = DEFAULT_RECENT,
): Promise<Map<string, number>> {
  const params: unknown[] = [venueId];
  let bandClause = "";
  if (bandId) {
    params.push(bandId);
    bandClause = `AND band_id = $${params.length}`;
  }
  params.push(recentSetlists);

  const lists = await query<{ id: string }>(
    `SELECT id FROM setlists WHERE venue_id = $1 ${bandClause} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  const listIds = lists.rows.map((row) => row.id);
  if (listIds.length === 0) return new Map();

  const rows = await query<{ song_id: string; play_count: string }>(
    `
    SELECT sss.song_id, COUNT(*) AS play_count
    FROM setlist_sets ss
    JOIN setlist_set_songs sss ON sss.set_id = ss.id
    WHERE ss.setlist_id = ANY($1::text[])
    GROUP BY sss.song_id
    `,
    [listIds],
  );

  const counts = new Map<string, number>();
  for (const row of rows.rows) counts.set(row.song_id, Number(row.play_count));
  return counts;
}

export function scoreSongForRecommendation(songId: string, playCounts: Map<string, number>): number {
  const plays = playCounts.get(songId) ?? 0;
  return -plays;
}
