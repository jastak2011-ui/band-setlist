import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { querySongsByIds } from "@/lib/db";
import { buildSets, explainBuiltSets, type SetBuildEventType, type SongForSet } from "@/lib/set-builder";
import { getCrowdResponseStats, getVenueSongPlayCounts, scoreVenueAwareRecommendation } from "@/lib/recommendations";
import { holidaySongsOutsideSeason } from "@/lib/seasonality";

const strategy = z.enum(["balanced", "high-energy", "dance-heavy", "singalong-heavy", "acoustic-chill", "build-slowly"]);
const eventType = z.enum(["bar-crowd", "brewery", "private-party", "wedding", "corporate-event"]);

const body = z.object({
  songIds: z.array(z.string()).min(1),
  numSets: z.number().int().min(1).max(12),
  venueId: z.string().optional(),
  bandId: z.string().optional(),
  strategy: strategy.optional(),
  eventType: eventType.optional(),
  avoidSameArtist: z.boolean().optional(),
  avoidSameGenre: z.boolean().optional(),
  avoidBigBpmDrops: z.boolean().optional(),
  avoidHardVocals: z.boolean().optional(),
  saveStrongestForLater: z.boolean().optional(),
  performedAt: z.string().optional(),
  allowHolidaySongIds: z.array(z.string()).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const json = await req.json();
    const parsed = body.safeParse(json);
    if (!parsed.success) {
      return privateJson({ error: parsed.error.flatten() }, { status: 400 });
    }
    if (parsed.data.bandId) await requireBandAccess(user, parsed.data.bandId);
    if (parsed.data.venueId && !parsed.data.bandId && user.role !== "admin") return privateJson({ error: "bandId required" }, { status: 400 });

  const rows = await querySongsByIds(parsed.data.songIds);
  if (rows.length === 0) {
    return privateJson({ error: "No matching songs" }, { status: 400 });
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = parsed.data.songIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;

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
    notes: r.notes,
    crowdScore: r.crowdScore,
    danceability: r.danceability,
    vocalDifficulty: r.vocalDifficulty,
    singalongScore: r.singalongScore,
    peakHourScore: r.peakHourScore,
    transitionFlexibility: r.transitionFlexibility,
    femaleParticipationScore: r.femaleParticipationScore,
    audienceAgeAppeal: r.audienceAgeAppeal,
    openerCandidate: r.openerCandidate,
    closerCandidate: r.closerCandidate,
    capoOrTuning: r.capoOrTuning,
    avoidAfter: r.avoidAfter,
  }));
  const allowedHolidayIds = new Set(parsed.data.allowHolidaySongIds ?? []);
  const excludedHolidaySongs = holidaySongsOutsideSeason(forSets, parsed.data.performedAt).filter((song) => !allowedHolidayIds.has(song.id));
  const excludedHolidayIds = new Set(excludedHolidaySongs.map((song) => song.id));
  const buildableSongs = forSets.filter((song) => !excludedHolidayIds.has(song.id));
  if (buildableSongs.length === 0) {
    return privateJson({ error: "No songs are available after applying holiday season filters." }, { status: 400 });
  }

  const buildOptions = {
    strategy: parsed.data.strategy,
    eventType: parsed.data.eventType,
    avoidSameArtist: parsed.data.avoidSameArtist,
    avoidSameGenre: parsed.data.avoidSameGenre,
    avoidBigBpmDrops: parsed.data.avoidBigBpmDrops,
    avoidHardVocals: parsed.data.avoidHardVocals,
    saveStrongestForLater: parsed.data.saveStrongestForLater,
  };

  let sets = buildSets(buildableSongs, parsed.data.numSets, buildOptions);

  if (parsed.data.venueId) {
    const counts = await getVenueSongPlayCounts(parsed.data.venueId, parsed.data.bandId);
    const responseStats = await getCrowdResponseStats(parsed.data.venueId, parsed.data.bandId);
    const scored = buildableSongs
      .map((s) => ({
        song: s,
        score: scoreVenueAwareRecommendation(s, counts, parsed.data.eventType ?? "bar-crowd", responseStats.get(s.id)).score,
        plays: counts.get(s.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score || a.plays - b.plays);

    const preferredOrder = scored.map((x) => x.song);
    const preferredIds = new Set(preferredOrder.map((s) => s.id));
    const rest = buildableSongs.filter((s) => !preferredIds.has(s.id));
    sets = buildSets([...preferredOrder, ...rest], parsed.data.numSets, buildOptions);
  }

  return privateJson({
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
        genre: s.genre,
      })),
    })),
    explainability: explainBuiltSets(sets, { eventType: parsed.data.eventType as SetBuildEventType | undefined, excludedHolidaySongs }),
  });
  } catch (error) {
    return authErrorResponse(error);
  }
}
