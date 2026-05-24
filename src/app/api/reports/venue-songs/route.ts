import { NextResponse } from "next/server";
import { authErrorResponse, getAccessibleBandIds, requireBandAccess, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

type GroupTotalRow = {
  band_id: string | null;
  band_name: string | null;
  venue_id: string;
  venue_name: string;
  total_setlists: string;
};

type SongReportRow = {
  band_id: string | null;
  band_name: string | null;
  venue_id: string;
  venue_name: string;
  song_id: string;
  title: string;
  artist: string;
  play_count: string;
  setlist_count: string;
};

function buildWhere(venueId: string | null, bandId: string | null, accessibleBandIds: string[] | null) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (venueId) {
    params.push(venueId);
    clauses.push(`sl.venue_id = $${params.length}`);
  }

  if (bandId) {
    if (bandId === "__none") {
      clauses.push("sl.band_id IS NULL");
    } else {
      params.push(bandId);
      clauses.push(`sl.band_id = $${params.length}`);
    }
  } else if (accessibleBandIds !== null) {
    if (accessibleBandIds.length === 0) clauses.push("FALSE");
    else {
      params.push(accessibleBandIds);
      clauses.push(`sl.band_id = ANY($${params.length}::text[])`);
    }
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function GET(req: Request) {
  try {
  const user = await requireUser();
  const url = new URL(req.url);
  const venueId = url.searchParams.get("venueId");
  const bandId = url.searchParams.get("bandId");
  if (bandId === "__none" && user.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  if (bandId && bandId !== "__none") await requireBandAccess(user, bandId);
  const filters = buildWhere(venueId, bandId, await getAccessibleBandIds(user));

  const groupTotals = await query<GroupTotalRow>(
    `
    SELECT
      sl.band_id,
      COALESCE(b.name, 'No band assigned') AS band_name,
      v.id AS venue_id,
      v.name AS venue_name,
      COUNT(sl.id) AS total_setlists
    FROM setlists sl
    LEFT JOIN bands b ON b.id = sl.band_id
    JOIN venues v ON v.id = sl.venue_id
    ${filters.where}
    GROUP BY sl.band_id, band_name, v.id, v.name
    ORDER BY lower(COALESCE(b.name, 'No band assigned')), lower(v.name)
    `,
    filters.params,
  );

  const rows = await query<SongReportRow>(
    `
    SELECT
      sl.band_id,
      COALESCE(b.name, 'No band assigned') AS band_name,
      v.id AS venue_id,
      v.name AS venue_name,
      s.id AS song_id,
      s.title,
      s.artist,
      COUNT(sss.id) AS play_count,
      COUNT(DISTINCT sl.id) AS setlist_count
    FROM setlists sl
    LEFT JOIN bands b ON b.id = sl.band_id
    JOIN venues v ON v.id = sl.venue_id
    JOIN setlist_sets ss ON ss.setlist_id = sl.id
    JOIN setlist_set_songs sss ON sss.set_id = ss.id
    JOIN songs s ON s.id = sss.song_id
    ${filters.where}
    GROUP BY sl.band_id, band_name, v.id, v.name, s.id, s.title, s.artist
    ORDER BY lower(COALESCE(b.name, 'No band assigned')), lower(v.name), play_count DESC, lower(s.title)
    `,
    filters.params,
  );

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

  for (const group of groupTotals.rows) {
    const bandKey = group.band_id ?? "__none";
    let band = bandMap.get(bandKey);
    if (!band) {
      band = { id: group.band_id, name: group.band_name ?? "No band assigned", totalSetlists: 0, venues: [] };
      bandMap.set(bandKey, band);
    }

    const venue = { id: group.venue_id, name: group.venue_name, totalSetlists: Number(group.total_setlists), songs: [] };
    band.totalSetlists += venue.totalSetlists;
    band.venues.push(venue);
    venueMap.set(`${bandKey}:${group.venue_id}`, venue);
  }

  for (const row of rows.rows) {
    const bandKey = row.band_id ?? "__none";
    const venue = venueMap.get(`${bandKey}:${row.venue_id}`);
    if (!venue) continue;
    const setlistCount = Number(row.setlist_count);
    venue.songs.push({
      id: row.song_id,
      title: row.title,
      artist: row.artist,
      playCount: Number(row.play_count),
      setlistCount,
      playPercent: venue.totalSetlists > 0 ? (setlistCount / venue.totalSetlists) * 100 : 0,
    });
  }

  return NextResponse.json({ bands: Array.from(bandMap.values()) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
