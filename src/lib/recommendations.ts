import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { setlistSetSongs, setlistSets, setlists } from "./db/schema";

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
  const db = getDb();
  const conditions = bandId ? and(eq(setlists.venueId, venueId), eq(setlists.bandId, bandId)) : eq(setlists.venueId, venueId);
  const lists = await db
    .select({ id: setlists.id })
    .from(setlists)
    .where(conditions)
    .orderBy(desc(setlists.createdAt))
    .limit(recentSetlists);

  const listIds = lists.map((l) => l.id);
  if (listIds.length === 0) return new Map();

  const setRows = await db.select({ id: setlistSets.id }).from(setlistSets).where(inArray(setlistSets.setlistId, listIds));
  const setIds = setRows.map((s) => s.id);
  if (setIds.length === 0) return new Map();

  const songRows = await db.select({ songId: setlistSetSongs.songId }).from(setlistSetSongs).where(inArray(setlistSetSongs.setId, setIds));
  const counts = new Map<string, number>();
  for (const row of songRows) counts.set(row.songId, (counts.get(row.songId) ?? 0) + 1);
  return counts;
}

export function scoreSongForRecommendation(songId: string, playCounts: Map<string, number>): number {
  const plays = playCounts.get(songId) ?? 0;
  return -plays;
}