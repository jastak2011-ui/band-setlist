import { NextResponse } from "next/server";
import { authErrorResponse, requireBandAccess, requireUser } from "@/lib/auth";
import { mapSong, query } from "@/lib/db";
import { getVenueSongPlayCounts, scoreSongForRecommendation } from "@/lib/recommendations";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const venueId = url.searchParams.get("venueId");
    const bandId = url.searchParams.get("bandId") || undefined;
    if (!venueId) return NextResponse.json({ error: "venueId required" }, { status: 400 });
    if (bandId) await requireBandAccess(user, bandId);
    if (!bandId && user.role !== "admin") return NextResponse.json({ error: "bandId required" }, { status: 400 });

  const allSongs = (await query("SELECT * FROM songs ORDER BY lower(title), lower(artist)")).rows.map(mapSong);
  const seed = Number(url.searchParams.get("seed") ?? Date.now());
  const counts = await getVenueSongPlayCounts(venueId, bandId);

  const ranked = allSongs
    .map((s) => ({ song: s, plays: counts.get(s.id) ?? 0, score: scoreSongForRecommendation(s.id, counts), tie: seededSongTie(s.id, seed) }))
    .sort((a, b) => b.score - a.score || a.plays - b.plays || a.tie - b.tie);

    return NextResponse.json({
    venueId,
    bandId: bandId ?? null,
    ranked: ranked.map((r) => ({
      id: r.song.id,
      title: r.song.title,
      artist: r.song.artist,
      bpm: r.song.bpm,
      durationSec: r.song.durationSec,
      recentPlaysAtVenue: r.plays,
    })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
function seededSongTie(id: string, seed: number) {
  let hash = seed || 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
