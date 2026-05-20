import { NextResponse } from "next/server";
import { getSqlite } from "@/lib/db";

type GroupTotalRow = {
  bandId: string | null;
  bandName: string | null;
  venueId: string;
  venueName: string;
  totalSetlists: number;
};

type SongReportRow = {
  bandId: string | null;
  bandName: string | null;
  venueId: string;
  venueName: string;
  songId: string;
  title: string;
  artist: string;
  playCount: number;
  setlistCount: number;
};

function buildWhere(venueId: string | null, bandId: string | null) {
  const clauses: string[] = [];
  const params: string[] = [];

  if (venueId) {
    clauses.push("sl.venue_id = ?");
    params.push(venueId);
  }

  if (bandId) {
    if (bandId === "__none") {
      clauses.push("sl.band_id IS NULL");
    } else {
      clauses.push("sl.band_id = ?");
      params.push(bandId);
    }
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const venueId = url.searchParams.get("venueId");
  const bandId = url.searchParams.get("bandId");
  const sqlite = getSqlite();
  const filters = buildWhere(venueId, bandId);

  const groupTotals = sqlite
    .prepare(
      `
      SELECT
        sl.band_id AS bandId,
        COALESCE(b.name, 'No band assigned') AS bandName,
        v.id AS venueId,
        v.name AS venueName,
        COUNT(sl.id) AS totalSetlists
      FROM setlists sl
      LEFT JOIN bands b ON b.id = sl.band_id
      JOIN venues v ON v.id = sl.venue_id
      ${filters.where}
      GROUP BY sl.band_id, bandName, v.id, v.name
      ORDER BY bandName COLLATE NOCASE, v.name COLLATE NOCASE
      `,
    )
    .all(...filters.params) as GroupTotalRow[];

  const rows = sqlite
    .prepare(
      `
      SELECT
        sl.band_id AS bandId,
        COALESCE(b.name, 'No band assigned') AS bandName,
        v.id AS venueId,
        v.name AS venueName,
        s.id AS songId,
        s.title AS title,
        s.artist AS artist,
        COUNT(sss.id) AS playCount,
        COUNT(DISTINCT sl.id) AS setlistCount
      FROM setlists sl
      LEFT JOIN bands b ON b.id = sl.band_id
      JOIN venues v ON v.id = sl.venue_id
      JOIN setlist_sets ss ON ss.setlist_id = sl.id
      JOIN setlist_set_songs sss ON sss.set_id = ss.id
      JOIN songs s ON s.id = sss.song_id
      ${filters.where}
      GROUP BY sl.band_id, bandName, v.id, v.name, s.id, s.title, s.artist
      ORDER BY bandName COLLATE NOCASE, v.name COLLATE NOCASE, playCount DESC, s.title COLLATE NOCASE
      `,
    )
    .all(...filters.params) as SongReportRow[];

  const bandMap = new Map<
    string,
    {
      id: string | null;
      name: string;
      totalSetlists: number;
      venues: Array<{
        id: string;
        name: string;
        totalSetlists: number;
        songs: Array<{
          id: string;
          title: string;
          artist: string;
          playCount: number;
          setlistCount: number;
          playPercent: number;
        }>;
      }>;
    }
  >();
  const venueMap = new Map<string, { totalSetlists: number; songs: Array<{ id: string; title: string; artist: string; playCount: number; setlistCount: number; playPercent: number }> }>();

  for (const group of groupTotals) {
    const bandKey = group.bandId ?? "__none";
    let band = bandMap.get(bandKey);
    if (!band) {
      band = { id: group.bandId, name: group.bandName ?? "No band assigned", totalSetlists: 0, venues: [] };
      bandMap.set(bandKey, band);
    }

    const venue = { id: group.venueId, name: group.venueName, totalSetlists: group.totalSetlists, songs: [] };
    band.totalSetlists += group.totalSetlists;
    band.venues.push(venue);
    venueMap.set(`${bandKey}:${group.venueId}`, venue);
  }

  for (const row of rows) {
    const bandKey = row.bandId ?? "__none";
    const venue = venueMap.get(`${bandKey}:${row.venueId}`);
    if (!venue) continue;
    venue.songs.push({
      id: row.songId,
      title: row.title,
      artist: row.artist,
      playCount: row.playCount,
      setlistCount: row.setlistCount,
      playPercent: venue.totalSetlists > 0 ? (row.setlistCount / venue.totalSetlists) * 100 : 0,
    });
  }

  return NextResponse.json({ bands: Array.from(bandMap.values()) });
}