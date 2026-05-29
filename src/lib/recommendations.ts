import { query } from "./db";

const DEFAULT_RECENT = 10;

export type RecommendationEventType = "bar-crowd" | "brewery" | "private-party" | "wedding" | "corporate-event";

type RecommendationSong = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  energy: number | null;
  genre: string | null;
  vibe: string | null;
  notes: string | null;
  crowdScore: number | null;
  danceability: number | null;
  singalongScore: number | null;
  peakHourScore: number | null;
  transitionFlexibility: number | null;
  audienceAgeAppeal: string[] | null;
  femaleParticipationScore: number | null;
};

type ScoringDetail = { label: string; value: string | number };

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

const eventLabels: Record<RecommendationEventType, string> = {
  "bar-crowd": "Bar Crowd",
  brewery: "Brewery",
  "private-party": "Private Party",
  wedding: "Wedding",
  "corporate-event": "Corporate Event",
};

function rating(value: number | null | undefined, fallback = 0.5) {
  if (value == null) return fallback;
  return Math.max(0, Math.min(1, value > 1 ? value / 10 : value));
}

function broadAgeAppeal(song: Pick<RecommendationSong, "audienceAgeAppeal">) {
  const ages = new Set(song.audienceAgeAppeal ?? []);
  if (ages.has("All Ages")) return 1;
  return Math.min(1, ages.size / 4);
}

function allAges(song: Pick<RecommendationSong, "audienceAgeAppeal">) {
  return song.audienceAgeAppeal?.includes("All Ages") ? 1 : 0;
}

function cleanMainstreamScore(song: Pick<RecommendationSong, "title" | "artist" | "genre" | "vibe" | "notes">) {
  const text = [song.title, song.artist, song.genre, song.vibe, song.notes].filter(Boolean).join(" ").toLowerCase();
  const explicit = /\b(explicit|offensive|dirty|nsfw|profane|profanity|raunchy)\b/.test(text);
  const niche = /\b(punk|metal|hardcore|edm|rap|hip hop|trap|industrial)\b/.test(text);
  return Math.max(0, 1 - (explicit ? 0.75 : 0) - (niche ? 0.25 : 0));
}

function effectiveEnergy(song: Pick<RecommendationSong, "energy" | "bpm">) {
  if (song.energy != null) return rating(song.energy);
  return Math.max(0.25, Math.min(0.9, ((song.bpm ?? 120) - 70) / 100));
}

function eventFitScore(song: RecommendationSong, eventType: RecommendationEventType) {
  const crowd = rating(song.crowdScore);
  const dance = rating(song.danceability);
  const singalong = rating(song.singalongScore, crowd);
  const female = rating(song.femaleParticipationScore, dance);
  const peak = rating(song.peakHourScore, Math.max(crowd, dance));
  const flex = rating(song.transitionFlexibility);
  const energy = effectiveEnergy(song);
  const broadAge = broadAgeAppeal(song);
  const safe = cleanMainstreamScore(song);
  if (eventType === "brewery") return crowd * 0.28 + energy * 0.2 + singalong * 0.19 + broadAge * 0.19 + dance * 0.08 + peak * 0.06;
  if (eventType === "private-party") return singalong * 0.27 + crowd * 0.24 + dance * 0.18 + broadAge * 0.16 + female * 0.1 + (1 - Math.abs(energy - 0.65)) * 0.05;
  if (eventType === "wedding") return singalong * 0.28 + female * 0.21 + dance * 0.19 + allAges(song) * 0.14 + crowd * 0.13 + flex * 0.05;
  if (eventType === "corporate-event") return crowd * 0.28 + broadAge * 0.22 + safe * 0.18 + (1 - Math.abs(energy - 0.58)) * 0.16 + flex * 0.16;
  return energy * 0.22 + crowd * 0.22 + singalong * 0.18 + dance * 0.16 + female * 0.12 + peak * 0.1;
}

function scoreOutOfTen(value: number) {
  return Math.round(value * 10);
}

function scoringFactorValues(song: RecommendationSong, eventType: RecommendationEventType) {
  const crowd = rating(song.crowdScore);
  const dance = rating(song.danceability);
  const singalong = rating(song.singalongScore, crowd);
  const female = rating(song.femaleParticipationScore, dance);
  const peak = rating(song.peakHourScore, Math.max(crowd, dance));
  const broadAge = broadAgeAppeal(song);
  const safe = cleanMainstreamScore(song);
  const energy = effectiveEnergy(song);
  const fit = eventFitScore(song, eventType);
  return [
    { key: "singalong", label: "Singalong", value: singalong, highReason: "High singalong score", lowReason: "Low singalong score" },
    { key: "danceability", label: "Danceability", value: dance, highReason: "Excellent danceability", lowReason: "Low danceability score" },
    { key: "femaleParticipation", label: "Female Participation", value: female, highReason: "High female participation", lowReason: "Low female participation" },
    { key: "crowdFamiliarity", label: "Crowd Familiarity", value: crowd, highReason: "High crowd familiarity", lowReason: "Low crowd familiarity" },
    { key: "broadAge", label: "Broad Age Appeal", value: broadAge, highReason: "Broad age appeal", lowReason: "Narrow audience age appeal" },
    { key: "peakHour", label: "Peak Hour", value: peak, highReason: "Strong peak-hour score", lowReason: "Low peak-hour score" },
    { key: "energy", label: "Energy", value: energy, highReason: "Strong energy", lowReason: "Low energy score" },
    { key: "safeMainstream", label: "Mainstream Safety", value: safe, highReason: "Clean mainstream fit", lowReason: "Niche or risky content signals" },
    { key: "eventFit", label: `${eventLabels[eventType]} Fit`, value: fit, highReason: `Excellent ${eventLabels[eventType].toLowerCase()} fit`, lowReason: `Low ${eventLabels[eventType].toLowerCase()} fit score` },
  ];
}

function scoringDetails(song: RecommendationSong, eventType: RecommendationEventType): ScoringDetail[] {
  const values = scoringFactorValues(song, eventType);
  return [
    { label: "Singalong", value: scoreOutOfTen(values.find((item) => item.key === "singalong")?.value ?? 0) },
    { label: "Danceability", value: scoreOutOfTen(values.find((item) => item.key === "danceability")?.value ?? 0) },
    { label: "Female Participation", value: scoreOutOfTen(values.find((item) => item.key === "femaleParticipation")?.value ?? 0) },
    { label: "Crowd Familiarity", value: scoreOutOfTen(values.find((item) => item.key === "crowdFamiliarity")?.value ?? 0) },
    { label: "Audience Age Appeal", value: song.audienceAgeAppeal?.length ? song.audienceAgeAppeal.join(", ") : "Not set" },
    { label: "Peak Hour", value: scoreOutOfTen(values.find((item) => item.key === "peakHour")?.value ?? 0) },
  ];
}

function topScoringFactors(song: RecommendationSong, eventType: RecommendationEventType) {
  return scoringFactorValues(song, eventType)
    .filter((item) => item.key !== "eventFit")
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((item) => item.highReason);
}

export function poorRecommendationReasons(song: RecommendationSong, eventType: RecommendationEventType) {
  return scoringFactorValues(song, eventType)
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((item) => item.lowReason);
}

function recommendationReasons(song: RecommendationSong, eventType: RecommendationEventType, recentPlays: number) {
  const reasons: string[] = [];
  const crowd = rating(song.crowdScore);
  const singalong = rating(song.singalongScore, crowd);
  const dance = rating(song.danceability);
  const female = rating(song.femaleParticipationScore, dance);
  const peak = rating(song.peakHourScore, Math.max(crowd, dance));
  const broadAge = broadAgeAppeal(song);
  if (singalong >= 0.75) reasons.push("High singalong");
  if (female >= 0.75) reasons.push("High female participation");
  if (dance >= 0.75) reasons.push("Strong danceability");
  if (crowd >= 0.75) reasons.push("High crowd familiarity");
  if (peak >= 0.8) reasons.push("Strong peak-hour song");
  if (broadAge >= 0.75) reasons.push("Broad age appeal");
  if (recentPlays === 0) reasons.push("Fresh for this venue");
  if (eventType === "wedding" && eventFitScore(song, eventType) >= 0.78) reasons.push("Excellent wedding fit");
  if (eventType === "corporate-event" && cleanMainstreamScore(song) >= 0.85) reasons.push("Clean mainstream fit");
  if (eventType === "brewery" && broadAge >= 0.5) reasons.push("Good brewery crowd fit");
  if (reasons.length === 0) reasons.push(`Solid ${eventLabels[eventType]} fit`);
  return reasons.slice(0, 4);
}

export function scoreVenueAwareRecommendation(song: RecommendationSong, playCounts: Map<string, number>, eventType: RecommendationEventType) {
  const recentPlays = playCounts.get(song.id) ?? 0;
  const fit = eventFitScore(song, eventType);
  const freshness = Math.max(0, 1 - recentPlays / 4);
  const score = Math.max(0, Math.min(10, (fit * 0.82 + freshness * 0.18) * 10));
  return {
    score,
    fitLabel: `${eventLabels[eventType]} Fit`,
    reasons: recommendationReasons(song, eventType, recentPlays),
    topFactors: topScoringFactors(song, eventType),
    scoringDetails: scoringDetails(song, eventType),
  };
}
