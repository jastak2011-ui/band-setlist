import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { songs } from "@/lib/db/schema";
import { buildSets, type SongForSet } from "@/lib/set-builder";
import { getVenueSongPlayCounts, scoreSongForRecommendation } from "@/lib/recommendations";

const strategy = z.enum(["balanced", "high-energy", "dance-heavy", "singalong-heavy", "acoustic-chill", "build-slowly"]);

const body = z.object({
  songIds: z.array(z.string()).min(1),
  numSets: z.number().int().min(1).max(12),
  venueId: z.string().optional(),
  bandId: z.string().optional(),
  strategy: strategy.optional(),
  avoidSameArtist: z.boolean().optional(),
  avoidSameGenre: z.boolean().optional(),
  avoidBigBpmDrops: z.boolean().optional(),
  avoidHardVocals: z.boolean().optional(),
  saveStrongestForLater: z.boolean().optional(),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const rows = await db.select().from(songs).where(inArray(songs.id, parsed.data.songIds));
  if (rows.length === 0) {
    return NextResponse.json({ error: "No matching songs" }, { status: 400 });
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = parsed.data.songIds
    .map((id) => byId.get(id))
    .filter(Boolean) as typeof rows;

  const forSets: SongForSet[] = ordered.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    bpm: r.bpm,
    musicalKey: r.musicalKey,
    durationSec: r.durationSec,
    energy: r.energy,
    genre: r.genre,
    vibe: r.vibe,
    crowdScore: r.crowdScore,
    danceability: r.danceability,
    vocalDifficulty: r.vocalDifficulty,
    openerCandidate: r.openerCandidate,
    closerCandidate: r.closerCandidate,
    leadSinger: r.leadSinger,
    capoOrTuning: r.capoOrTuning,
    avoidAfter: r.avoidAfter,
  }));

  const buildOptions = {
    strategy: parsed.data.strategy,
    avoidSameArtist: parsed.data.avoidSameArtist,
    avoidSameGenre: parsed.data.avoidSameGenre,
    avoidBigBpmDrops: parsed.data.avoidBigBpmDrops,
    avoidHardVocals: parsed.data.avoidHardVocals,
    saveStrongestForLater: parsed.data.saveStrongestForLater,
  };

  let sets = buildSets(forSets, parsed.data.numSets, buildOptions);

  if (parsed.data.venueId) {
    const counts = await getVenueSongPlayCounts(parsed.data.venueId, parsed.data.bandId);
    const scored = forSets
      .map((s) => ({
        song: s,
        score: scoreSongForRecommendation(s.id, counts),
        plays: counts.get(s.id) ?? 0,
      }))
      .sort((a, b) => a.score - b.score || a.plays - b.plays);

    const preferredOrder = scored.map((x) => x.song);
    const preferredIds = new Set(preferredOrder.map((s) => s.id));
    const rest = forSets.filter((s) => !preferredIds.has(s.id));
    const reweighted = [...preferredOrder, ...rest];
    sets = buildSets(reweighted, parsed.data.numSets, buildOptions);
  }

  return NextResponse.json({
    sets: sets.map((songsInSet, i) => ({
      index: i + 1,
      songs: songsInSet.map((s, j) => ({
        position: j + 1,
        id: s.id,
        title: s.title,
        artist: s.artist,
        bpm: s.bpm,
        musicalKey: s.musicalKey,
        durationSec: s.durationSec,
        energy: s.energy,
      })),
    })),
  });
}
