import "server-only";

export type MetadataLookupResult = {
  source: "musicbrainz" | "musicbrainz-lastfm" | "lastfm" | "none";
  matchedTitle?: string;
  matchedArtist?: string;
  musicBrainzRecordingId?: string;
  lastfmUrl?: string;
  durationSec: number | null;
  crowdScore: number | null;
  genre: string | null;
  vibe: string | null;
  message?: string;
};

type MusicBrainzRecording = {
  id?: string;
  title?: string;
  length?: number;
  score?: number | string;
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
};

type LastFmTrack = {
  name?: string;
  artist?: { name?: string } | string;
  url?: string;
  listeners?: string;
  toptags?: { tag?: { name?: string }[] };
};

const GENRE_WORDS = [
  "rock",
  "pop",
  "country",
  "folk",
  "blues",
  "jazz",
  "soul",
  "funk",
  "punk",
  "metal",
  "hip hop",
  "hip-hop",
  "rap",
  "alternative",
  "indie",
  "r&b",
  "reggae",
  "electronic",
  "dance",
  "disco",
  "americana",
  "classic rock",
  "new wave",
  "southern rock",
];

const VIBE_WORDS = [
  "acoustic",
  "ballad",
  "chill",
  "dance",
  "dark",
  "energetic",
  "happy",
  "live",
  "mellow",
  "party",
  "romantic",
  "sad",
  "singalong",
  "slow",
  "upbeat",
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(a: string, b: string) {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.max(left.size, right.size);
}

function quoted(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function artistName(recording: MusicBrainzRecording) {
  return (recording["artist-credit"] ?? [])
    .map((credit) => credit.artist?.name ?? credit.name)
    .filter(Boolean)
    .join(", ");
}

function rankRecording(recording: MusicBrainzRecording, title: string, artist: string) {
  const mbScore = Number(recording.score ?? 0) / 100;
  return mbScore * 0.5 + similarity(recording.title ?? "", title) * 0.3 + similarity(artistName(recording), artist) * 0.2;
}

function listenersToCrowdScore(value: string | undefined) {
  const listeners = Number(value);
  if (!Number.isFinite(listeners) || listeners <= 0) return null;
  // Log scale keeps niche songs from all reading as 1 while reserving 9-10 for very familiar songs.
  return Math.max(1, Math.min(10, Math.round(Math.log10(listeners) * 1.5)));
}

function pickTag(tags: string[], options: string[]) {
  return tags.find((tag) => options.some((option) => normalize(tag).includes(normalize(option)))) ?? null;
}

async function lookupMusicBrainz(title: string, artist: string) {
  const url = new URL("https://musicbrainz.org/ws/2/recording/");
  url.searchParams.set("query", `recording:${quoted(title)} AND artist:${quoted(artist)}`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "5");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "BandSetlist/1.0 (local metadata lookup)",
        Accept: "application/json",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown network error";
    return { recording: null, message: `MusicBrainz lookup failed before a response was received (${detail}).` };
  }

  if (response.status === 429) return { recording: null, message: "MusicBrainz rate limit reached. Try again shortly." };
  if (!response.ok) return { recording: null, message: `MusicBrainz lookup failed (${response.status}).` };

  const data = (await response.json()) as { recordings?: MusicBrainzRecording[] };
  const recordings = data.recordings ?? [];
  const recording = recordings.sort((a, b) => rankRecording(b, title, artist) - rankRecording(a, title, artist))[0] ?? null;
  if (!recording) return { recording: null, message: "No MusicBrainz recording match found." };
  if (rankRecording(recording, title, artist) < 0.45) return { recording: null, message: "No close MusicBrainz recording match found." };
  return { recording, message: null };
}

async function lookupLastFm(title: string, artist: string) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return { track: null, message: "Last.fm API key missing; genre, vibe, and crowd enrichment skipped." };

  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "track.getInfo");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("artist", artist);
  url.searchParams.set("track", title);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown network error";
    return { track: null, message: `Last.fm lookup failed before a response was received (${detail}).` };
  }

  if (response.status === 429) return { track: null, message: "Last.fm rate limit reached. Try again shortly." };
  if (!response.ok) return { track: null, message: `Last.fm lookup failed (${response.status}).` };

  const data = (await response.json()) as { track?: LastFmTrack; error?: number; message?: string };
  if (data.error || !data.track) return { track: null, message: data.message ?? "No Last.fm track match found." };
  return { track: data.track, message: null };
}

function parseLastFmTags(track: LastFmTrack | null) {
  const tags = (track?.toptags?.tag ?? []).map((tag) => tag.name).filter((tag): tag is string => Boolean(tag));
  const genre = pickTag(tags, GENRE_WORDS) ?? tags.find((tag) => !pickTag([tag], VIBE_WORDS)) ?? null;
  const vibe = pickTag(tags, VIBE_WORDS);
  return { genre, vibe };
}

export async function lookupSongMetadata(title: string, artist: string): Promise<MetadataLookupResult> {
  const mb = await lookupMusicBrainz(title, artist);
  const matchedTitle = mb.recording?.title ?? title;
  const matchedArtist = mb.recording ? artistName(mb.recording) || artist : artist;
  const lastfm = await lookupLastFm(matchedTitle, matchedArtist);
  const tags = parseLastFmTags(lastfm.track);
  const messages = [mb.message, lastfm.message].filter(Boolean);
  const hasMusicBrainz = Boolean(mb.recording);
  const hasLastFm = Boolean(lastfm.track);

  if (!hasMusicBrainz && !hasLastFm) {
    return {
      source: "none",
      durationSec: null,
      crowdScore: null,
      genre: null,
      vibe: null,
      message: messages.join(" ") || "No metadata match found.",
    };
  }

  return {
    source: hasMusicBrainz && hasLastFm ? "musicbrainz-lastfm" : hasMusicBrainz ? "musicbrainz" : "lastfm",
    musicBrainzRecordingId: mb.recording?.id,
    lastfmUrl: lastfm.track?.url,
    matchedTitle: lastfm.track?.name ?? mb.recording?.title ?? title,
    matchedArtist:
      typeof lastfm.track?.artist === "string"
        ? lastfm.track.artist
        : lastfm.track?.artist?.name ?? matchedArtist,
    durationSec: typeof mb.recording?.length === "number" ? Math.round(mb.recording.length / 1000) : null,
    crowdScore: listenersToCrowdScore(lastfm.track?.listeners),
    genre: tags.genre,
    vibe: tags.vibe,
    message: messages.join(" ") || undefined,
  };
}

