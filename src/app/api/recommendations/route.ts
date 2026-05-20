import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { songs } from "@/lib/db/schema";
import { getVenueSongPlayCounts, scoreSongForRecommendation } from "@/lib/recommendations";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const venueId = url.searchParams.get("venueId");
  const bandId = url.searchParams.get("bandId") || undefined;
  if (!venueId) return NextResponse.json({ error: "venueId required" }, { status: 400 });

  const db = getDb();
  const allSongs = await db.select().from(songs).orderBy(asc(songs.title));
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
}
function seededSongTie(id: string, seed: number) {
  let hash = seed || 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}