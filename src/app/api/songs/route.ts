import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, getAccessibleBandIds, requireUser } from "@/lib/auth";
import { mapSong, query } from "@/lib/db";
import { findOrCreateSong } from "@/lib/song-import";
import { audienceAgeAppealArraySchema } from "@/lib/audience-age";

const rating = z.number().min(0).max(10).transform((value) => (value > 1 ? value / 10 : value));
const source = z.enum(["manual", "inferred"]).nullable().optional();

const songInput = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  bpm: z.number().int().positive().max(400).optional().nullable(),
  musicalKey: z.string().max(32).optional().nullable(),
  durationSec: z.number().int().positive().max(36000).optional().nullable(),
  energy: rating.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  genre: z.string().max(80).optional().nullable(),
  vibe: z.string().max(120).optional().nullable(),
  crowdScore: rating.optional().nullable(),
  danceability: rating.optional().nullable(),
  vocalDifficulty: rating.optional().nullable(),
  singalongScore: rating.optional().nullable(),
  peakHourScore: rating.optional().nullable(),
  transitionFlexibility: rating.optional().nullable(),
  audienceAgeAppeal: audienceAgeAppealArraySchema.optional().nullable(),
  femaleParticipationScore: rating.optional().nullable(),
  singalongScoreSource: source,
  peakHourScoreSource: source,
  transitionFlexibilitySource: source,
  audienceAgeAppealSource: source,
  femaleParticipationScoreSource: source,
  openerCandidate: z.boolean().optional().nullable(),
  closerCandidate: z.boolean().optional().nullable(),
  capoOrTuning: z.string().max(120).optional().nullable(),
  avoidAfter: z.string().max(500).optional().nullable(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const result = await query("SELECT * FROM songs ORDER BY lower(title), lower(artist)");
    const accessibleBandIds = await getAccessibleBandIds(user);
    const ratingClause = accessibleBandIds === null ? "" : "AND band_id = ANY($1::text[])";
    const aliasedRatingClause = accessibleBandIds === null ? "" : "AND spr.band_id = ANY($1::text[])";
    const ratingParams = accessibleBandIds === null ? [] : [accessibleBandIds];
    const aggregateResult = await query(
      `
      SELECT song_id, AVG(crowd_response_score)::float AS average_response, COUNT(*)::int AS times_rated, MAX(performance_date) AS last_rated_at
      FROM song_performance_ratings
      WHERE crowd_response_score IS NOT NULL ${ratingClause}
      GROUP BY song_id
      `,
      ratingParams,
    );
    const bestVenueResult = await query(
      `
      SELECT DISTINCT ON (spr.song_id)
        spr.song_id,
        v.name AS venue_name,
        AVG(spr.crowd_response_score)::float AS average_response,
        COUNT(*)::int AS times_rated
      FROM song_performance_ratings spr
      JOIN venues v ON v.id = spr.venue_id
      WHERE spr.crowd_response_score IS NOT NULL ${aliasedRatingClause}
      GROUP BY spr.song_id, v.id, v.name
      ORDER BY spr.song_id, average_response DESC, times_rated DESC, lower(v.name)
      `,
      ratingParams,
    );
    const aggregates = new Map(aggregateResult.rows.map((row) => [row.song_id as string, row]));
    const bestVenues = new Map(bestVenueResult.rows.map((row) => [row.song_id as string, row]));
    return NextResponse.json(result.rows.map((row) => {
      const song = mapSong(row);
      const aggregate = aggregates.get(song.id);
      const bestVenue = bestVenues.get(song.id);
      return {
        ...song,
        crowdResponseAverage: aggregate?.average_response ?? null,
        crowdResponseCount: aggregate?.times_rated ?? 0,
        crowdResponseLastRatedAt: aggregate?.last_rated_at ?? null,
        crowdResponseBestVenue: bestVenue ? {
          name: bestVenue.venue_name,
          average: bestVenue.average_response,
          count: bestVenue.times_rated,
        } : null,
      };
    }));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const json = await req.json();
    const parsed = songInput.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await findOrCreateSong(parsed.data);
    return NextResponse.json({ ...result.song, importStatus: result.status }, { status: result.status === "created" ? 201 : 200 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
