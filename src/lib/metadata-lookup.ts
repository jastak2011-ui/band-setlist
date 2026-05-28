import "server-only";

import { lookupBpmFromDeezer } from "./bpm-deezer";
import { mapSong, query, type DbSong } from "@/lib/db";
import { normalizeSongIdentity } from "./song-import";

export type EnrichmentField =
  | "title"
  | "artist"
  | "bpm"
  | "durationSec"
  | "genre"
  | "vibe"
  | "crowdScore"
  | "danceability"
  | "energy"
  | "vocalDifficulty"
  | "openerCandidate"
  | "closerCandidate"
  | "musicalKey";

export type EnrichmentProposal = {
  field: EnrichmentField;
  current: string | number | boolean | null;
  proposed: string | number | boolean | null;
  source: "local-library" | "deezer" | "musicbrainz" | "lastfm" | "lastfm-tags" | "none";
  status: "found" | "not-found";
  note?: string;
};

export type MetadataLookupResult = {
  source: "enrichment" | "none";
  matchedTitle?: string;
  matchedArtist?: string;
  musicBrainzRecordingId?: string;
  lastfmUrl?: string;
  deezerTrackId?: string;
  proposals: EnrichmentProposal[];
  unavailable: EnrichmentProposal[];
  sourcesTried: string[];
  message?: string;
  // Legacy response fields retained for older callers.
  durationSec: number | null;
  crowdScore: number | null;
  genre: string | null;
  vibe: string | null;
  bpm: number | null;
  energy: number | null;
  danceability: number | null;
};

export type EnrichmentSongInput = {
  id?: string;
  title: string;
  artist: string;
  bpm?: number | null;
  musicalKey?: string | null;
  durationSec?: number | null;
  energy?: number | null;
  genre?: string | null;
  vibe?: string | null;
  crowdScore?: number | null;
  danceability?: number | null;
  vocalDifficulty?: number | null;
  openerCandidate?: boolean | null;
  closerCandidate?: boolean | null;
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
  playcount?: string;
  duration?: string;
  toptags?: { tag?: { name?: string }[] };
};

const targetFields: EnrichmentField[] = [
  "title",
  "artist",
  "bpm",
  "durationSec",
  "genre",
  "vibe",
  "crowdScore",
  "danceability",
  "energy",
  "vocalDifficulty",
  "openerCandidate",
  "closerCandidate",
  "musicalKey",
];

const GENRE_GROUPS = [
  { label: "Folk / Americana", tags: ["folk", "americana", "bluegrass", "singer-songwriter", "acoustic"] },
  { label: "Rock", tags: ["rock", "indie rock", "alternative", "classic rock", "southern rock"] },
  { label: "Pop", tags: ["pop", "dance pop", "synthpop"] },
  { label: "Funk / Soul", tags: ["funk", "soul", "r&b", "rhythm and blues"] },
  { label: "Country", tags: ["country", "alt-country"] },
  { label: "Blues", tags: ["blues"] },
];

const VIBE_GROUPS = [
  { label: "Acoustic storytelling", tags: ["folk", "americana", "acoustic", "singer-songwriter"] },
  { label: "Driving", tags: ["rock", "indie rock", "alternative", "energetic"] },
  { label: "Danceable", tags: ["dance", "funk", "disco", "pop"] },
  { label: "Singalong", tags: ["singalong", "sing-along", "anthem", "classic rock"] },
  { label: "Intimate", tags: ["ballad", "sad", "slow", "mellow", "chill"] },
];

function normalize(value: string) {
  return normalizeSongIdentity(value);
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
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

function currentValue(song: EnrichmentSongInput, field: EnrichmentField) {
  return song[field] ?? null;
}

function proposal(
  song: EnrichmentSongInput,
  field: EnrichmentField,
  proposed: string | number | boolean | null | undefined,
  source: EnrichmentProposal["source"],
  note?: string,
): EnrichmentProposal | null {
  if (!hasValue(proposed)) return null;
  return { field, current: currentValue(song, field), proposed: proposed ?? null, source, status: "found", note };
}

function notFound(song: EnrichmentSongInput, field: EnrichmentField, note: string): EnrichmentProposal {
  return { field, current: currentValue(song, field), proposed: null, source: "none", status: "not-found", note };
}

function listenersToCrowdScore(listenersValue?: string, playcountValue?: string) {
  const listeners = Number(listenersValue);
  const playcount = Number(playcountValue);
  const popularity = (Number.isFinite(listeners) ? listeners : 0) + (Number.isFinite(playcount) ? playcount / 4 : 0);
  if (popularity <= 0) return null;
  return Math.max(1, Math.min(10, Math.round(Math.log10(popularity) * 1.5)));
}

function tagNames(track: LastFmTrack | null) {
  return (track?.toptags?.tag ?? []).map((tag) => tag.name).filter((tag): tag is string => Boolean(tag));
}

function pickGroup(tags: string[], groups: Array<{ label: string; tags: string[] }>) {
  const normalizedTags = tags.map(normalize);
  return groups.find((group) => group.tags.some((tag) => normalizedTags.some((candidate) => candidate.includes(normalize(tag)))))?.label ?? null;
}

function inferFromTags(tags: string[]) {
  const normalizedTags = tags.map(normalize);
  const includes = (values: string[]) => values.some((value) => normalizedTags.some((tag) => tag.includes(normalize(value))));
  const inferred: {
    genre: string | null;
    vibe: string | null;
    crowdScore: number | null;
    danceability: number | null;
    energy: number | null;
    vocalDifficulty: number | null;
    openerCandidate: boolean | null;
    closerCandidate: boolean | null;
  } = {
    genre: pickGroup(tags, GENRE_GROUPS),
    vibe: pickGroup(tags, VIBE_GROUPS),
    crowdScore: null,
    danceability: null,
    energy: null,
    vocalDifficulty: null,
    openerCandidate: null,
    closerCandidate: null,
  };

  if (includes(["dance", "funk", "disco", "pop"])) {
    inferred.danceability = 0.8;
    inferred.energy = 0.75;
    inferred.crowdScore = 0.8;
    inferred.openerCandidate = true;
    inferred.closerCandidate = true;
  }
  if (includes(["rock", "indie rock", "alternative", "energetic"])) {
    inferred.energy = Math.max(inferred.energy ?? 0, 0.7);
    inferred.openerCandidate = true;
  }
  if (includes(["anthem", "singalong", "sing-along", "classic rock"])) {
    inferred.crowdScore = Math.max(inferred.crowdScore ?? 0, 0.85);
    inferred.closerCandidate = true;
  }
  if (includes(["ballad", "sad", "slow", "mellow", "chill"])) {
    inferred.energy = Math.min(inferred.energy ?? 0.4, 0.4);
    inferred.danceability = Math.min(inferred.danceability ?? 0.35, 0.35);
  }
  if (includes(["acoustic", "folk", "singer-songwriter"])) {
    inferred.energy = inferred.energy ?? 0.45;
    inferred.vocalDifficulty = inferred.vocalDifficulty ?? 0.5;
  }

  return inferred;
}

async function findLocalLibraryMatch(song: EnrichmentSongInput) {
  const rows = (await query("SELECT * FROM songs")).rows.map(mapSong) as DbSong[];
  const targetTitle = normalize(song.title);
  const targetArtist = normalize(song.artist);
  return rows.find((candidate) => {
    if (song.id && candidate.id === song.id) return false;
    return normalize(candidate.title) === targetTitle && normalize(candidate.artist) === targetArtist;
  }) ?? null;
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
  if (!apiKey) return { track: null, message: "Last.fm API key missing; tags, genre, vibe, and crowd enrichment skipped." };

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

export async function lookupSongMetadata(song: EnrichmentSongInput): Promise<MetadataLookupResult>;
export async function lookupSongMetadata(title: string, artist: string): Promise<MetadataLookupResult>;
export async function lookupSongMetadata(input: EnrichmentSongInput | string, maybeArtist?: string): Promise<MetadataLookupResult> {
  const song: EnrichmentSongInput = typeof input === "string"
    ? { title: input, artist: maybeArtist ?? "" }
    : input;
  const messages: string[] = [];
  const proposals: EnrichmentProposal[] = [];
  const sourcesTried = ["Existing local song library", "Deezer", "MusicBrainz", "Last.fm"];

  const local = await findLocalLibraryMatch(song);
  if (local) {
    for (const field of targetFields) {
      const item = proposal(song, field, local[field] ?? null, "local-library", "Exact normalized title/artist match in this library.");
      if (item) proposals.push(item);
    }
  }

  const deezer = await lookupBpmFromDeezer(song.title, song.artist);
  if (deezer.message) messages.push(deezer.message);
  proposals.push(
    ...[
      proposal(song, "bpm", deezer.bpm, "deezer", deezer.bpm == null ? "Deezer matched no BPM." : undefined),
      proposal(song, "durationSec", deezer.durationSec, "deezer"),
    ].filter((item): item is EnrichmentProposal => Boolean(item)),
  );

  const mb = await lookupMusicBrainz(song.title, song.artist);
  if (mb.message) messages.push(mb.message);
  const matchedTitle = mb.recording?.title ?? song.title;
  const matchedArtist = mb.recording ? artistName(mb.recording) || song.artist : song.artist;
  if (mb.recording) {
    proposals.push(
      ...[
        proposal(song, "title", mb.recording.title, "musicbrainz", "Canonical title from MusicBrainz."),
        proposal(song, "artist", matchedArtist, "musicbrainz", "Canonical artist credit from MusicBrainz."),
        proposal(song, "durationSec", typeof mb.recording.length === "number" ? Math.round(mb.recording.length / 1000) : null, "musicbrainz"),
      ].filter((item): item is EnrichmentProposal => Boolean(item)),
    );
  }

  const lastfm = await lookupLastFm(matchedTitle, matchedArtist);
  if (lastfm.message) messages.push(lastfm.message);
  const tags = tagNames(lastfm.track);
  const inferred = inferFromTags(tags);
  if (lastfm.track) {
    proposals.push(
      ...[
        proposal(song, "title", lastfm.track.name, "lastfm"),
        proposal(song, "artist", typeof lastfm.track.artist === "string" ? lastfm.track.artist : lastfm.track.artist?.name, "lastfm"),
        proposal(song, "durationSec", Number(lastfm.track.duration) > 0 ? Math.round(Number(lastfm.track.duration) / 1000) : null, "lastfm"),
        proposal(song, "genre", inferred.genre, "lastfm-tags", tags.length ? `Inferred conservatively from tags: ${tags.slice(0, 8).join(", ")}` : "No usable Last.fm tags."),
        proposal(song, "vibe", inferred.vibe, "lastfm-tags", tags.length ? `Inferred conservatively from tags: ${tags.slice(0, 8).join(", ")}` : "No usable Last.fm tags."),
        proposal(song, "crowdScore", inferred.crowdScore ?? listenersToCrowdScore(lastfm.track.listeners, lastfm.track.playcount), "lastfm", "Inferred from Last.fm tags/listeners/playcount."),
        proposal(song, "danceability", inferred.danceability, "lastfm-tags", "Conservative tag inference."),
        proposal(song, "energy", inferred.energy, "lastfm-tags", "Conservative tag inference."),
        proposal(song, "vocalDifficulty", inferred.vocalDifficulty, "lastfm-tags", "Conservative tag inference."),
        proposal(song, "openerCandidate", inferred.openerCandidate, "lastfm-tags", "Conservative tag inference."),
        proposal(song, "closerCandidate", inferred.closerCandidate, "lastfm-tags", "Conservative tag inference."),
      ].filter((item): item is EnrichmentProposal => Boolean(item)),
    );
  }

  const bestByField = new Map<EnrichmentField, EnrichmentProposal>();
  const sourcePriority: Record<EnrichmentProposal["source"], number> = {
    "local-library": 1,
    deezer: 2,
    musicbrainz: 3,
    lastfm: 4,
    "lastfm-tags": 4,
    none: 99,
  };
  for (const item of proposals) {
    const existing = bestByField.get(item.field);
    if (!existing || sourcePriority[item.source] < sourcePriority[existing.source]) bestByField.set(item.field, item);
  }

  const found = [...bestByField.values()];
  const unavailable = targetFields
    .filter((field) => !bestByField.has(field))
    .map((field) => notFound(song, field, notFoundNote(field, Boolean(process.env.LASTFM_API_KEY))));

  const byField = new Map(found.map((item) => [item.field, item.proposed]));
  return {
    source: found.length ? "enrichment" : "none",
    matchedTitle: String(byField.get("title") ?? matchedTitle ?? song.title),
    matchedArtist: String(byField.get("artist") ?? matchedArtist ?? song.artist),
    musicBrainzRecordingId: mb.recording?.id,
    lastfmUrl: lastfm.track?.url,
    deezerTrackId: deezer.deezerTrackId,
    proposals: found,
    unavailable,
    sourcesTried,
    message: messages.join(" ") || undefined,
    durationSec: typeof byField.get("durationSec") === "number" ? byField.get("durationSec") as number : null,
    crowdScore: typeof byField.get("crowdScore") === "number" ? byField.get("crowdScore") as number : null,
    genre: typeof byField.get("genre") === "string" ? byField.get("genre") as string : null,
    vibe: typeof byField.get("vibe") === "string" ? byField.get("vibe") as string : null,
    bpm: typeof byField.get("bpm") === "number" ? byField.get("bpm") as number : null,
    energy: typeof byField.get("energy") === "number" ? byField.get("energy") as number : null,
    danceability: typeof byField.get("danceability") === "number" ? byField.get("danceability") as number : null,
  };
}

function notFoundNote(field: EnrichmentField, hasLastFmKey: boolean) {
  if (field === "bpm") return "BPM was attempted through Deezer but was not available.";
  if (["genre", "vibe", "crowdScore", "danceability", "energy"].includes(field)) {
    return hasLastFmKey ? "No usable Last.fm tags/listeners found." : "Last.fm enrichment requires server env var LASTFM_API_KEY.";
  }
  if (field === "musicalKey") return "No reliable key source is configured for this pipeline.";
  return "Not found from available sources.";
}
