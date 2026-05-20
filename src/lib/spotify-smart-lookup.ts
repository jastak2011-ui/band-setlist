import "server-only";

export type SpotifySmartLookupResult = {
  source: "spotify" | "none";
  spotifyTrackId?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  durationSec: number | null;
  crowdScore: number | null;
  genre: string | null;
  bpm: number | null;
  musicalKey: string | null;
  energy: number | null;
  danceability: number | null;
  message?: string;
};

type SpotifyToken = { access_token?: string };
type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms?: number;
  popularity?: number;
  artists?: { id: string; name: string }[];
};
type SpotifyArtist = { genres?: string[] };
type SpotifyAudioFeatures = {
  tempo?: number;
  key?: number;
  mode?: number;
  energy?: number;
  danceability?: number;
};

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

function basicAuthHeader(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`, "utf8").toString("base64")}`;
}

function spotifyKeyToString(key: number, mode: number): string | null {
  if (key < 0 || key > 11) return null;
  return `${PITCH_CLASSES[key]} ${mode === 1 ? "major" : "minor"}`;
}

function popularityToRating(popularity: number | undefined) {
  if (typeof popularity !== "number") return null;
  return Math.max(1, Math.min(10, Math.round(popularity / 10) || 1));
}

function networkErrorMessage(error: unknown, action: string) {
  const detail = error instanceof Error ? error.message : "unknown network error";
  return `Spotify ${action} failed before a response was received (${detail}). Check internet/firewall access from this app.`;
}

async function spotifyErrorMessage(response: Response, action: string) {
  const text = await response.text().catch(() => "");
  if (!text) return `Spotify ${action} failed (${response.status}).`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; status?: number } | string; error_description?: string };
    if (typeof parsed.error === "object" && parsed.error?.message) return `Spotify ${action} failed (${response.status}): ${parsed.error.message}`;
    if (typeof parsed.error === "string") return `Spotify ${action} failed (${response.status}): ${parsed.error_description ?? parsed.error}`;
  } catch {
    // Plain-text error bodies are safe to show after truncating.
  }
  return `Spotify ${action} failed (${response.status}): ${text.slice(0, 180)}`;
}
async function getSpotifyAccessToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return { token: null, message: "Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env.local." };

  let response: Response;
  try {
    response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(id, secret),
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
  } catch (error) {
    return { token: null, message: networkErrorMessage(error, "token request") };
  }

  if (response.status === 429) return { token: null, message: "Spotify rate limit reached. Try again shortly." };
  if (!response.ok) return { token: null, message: await spotifyErrorMessage(response, "token request") };

  const data = (await response.json()) as SpotifyToken;
  return data.access_token ? { token: data.access_token, message: null } : { token: null, message: "Spotify token response missing access_token." };
}

async function searchTrack(token: string, title: string, artist: string) {
  const searchUrl = new URL("https://api.spotify.com/v1/search");
  searchUrl.searchParams.set("q", `track:${title} artist:${artist}`);
  searchUrl.searchParams.set("type", "track");
  searchUrl.searchParams.set("limit", "1");

  let response: Response;
  try {
    response = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    return { track: null, message: networkErrorMessage(error, "track search") };
  }
  if (response.status === 429) return { track: null, message: "Spotify rate limit reached. Try again shortly." };
  if (!response.ok) return { track: null, message: await spotifyErrorMessage(response, "track search") };

  const data = (await response.json()) as { tracks?: { items?: SpotifyTrack[] } };
  const track = data.tracks?.items?.[0] ?? null;
  return track ? { track, message: null } : { track: null, message: "No Spotify track match found." };
}

async function fetchArtistGenres(token: string, artistIds: string[]) {
  const ids = artistIds.filter(Boolean).slice(0, 3);
  if (ids.length === 0) return { genres: [] as string[], message: null as string | null };

  const url = new URL("https://api.spotify.com/v1/artists");
  url.searchParams.set("ids", ids.join(","));
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    return { genres: [] as string[], message: networkErrorMessage(error, "artist genre lookup") };
  }
  if (response.status === 429) return { genres: [] as string[], message: "Spotify rate limit reached while fetching artist genres." };
  if (!response.ok) return { genres: [] as string[], message: await spotifyErrorMessage(response, "artist genre lookup") };

  const data = (await response.json()) as { artists?: SpotifyArtist[] };
  return { genres: [...new Set((data.artists ?? []).flatMap((artist) => artist.genres ?? []))], message: null };
}

async function fetchAudioFeatures(token: string, trackId: string) {
  let response: Response;
  try {
    response = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return { features: null, message: networkErrorMessage(error, "audio features lookup") };
  }

  if ([403, 404].includes(response.status)) return { features: null, message: "Spotify audio features unavailable; filled available metadata only." };
  if (response.status === 429) return { features: null, message: "Spotify rate limit reached while fetching audio features." };
  if (!response.ok) return { features: null, message: `${await spotifyErrorMessage(response, "audio features lookup")}; filled available metadata only.` };

  const features = (await response.json()) as SpotifyAudioFeatures | null;
  return features ? { features, message: null } : { features: null, message: "Spotify audio features unavailable; filled available metadata only." };
}

export async function lookupSpotifySmartData(title: string, artist: string): Promise<SpotifySmartLookupResult> {
  const tokenResult = await getSpotifyAccessToken();
  if (!tokenResult.token) {
    return {
      source: "none",
      durationSec: null,
      crowdScore: null,
      genre: null,
      bpm: null,
      musicalKey: null,
      energy: null,
      danceability: null,
      message: tokenResult.message ?? "Spotify credentials unavailable.",
    };
  }

  const trackResult = await searchTrack(tokenResult.token, title, artist);
  if (!trackResult.track) {
    return {
      source: "none",
      durationSec: null,
      crowdScore: null,
      genre: null,
      bpm: null,
      musicalKey: null,
      energy: null,
      danceability: null,
      message: trackResult.message ?? "No Spotify track match found.",
    };
  }

  const track = trackResult.track;
  const genreResult = await fetchArtistGenres(tokenResult.token, (track.artists ?? []).map((row) => row.id));
  const featuresResult = await fetchAudioFeatures(tokenResult.token, track.id);
  const features = featuresResult.features;
  const messages = [genreResult.message, featuresResult.message].filter(Boolean);

  return {
    source: "spotify",
    spotifyTrackId: track.id,
    matchedTitle: track.name,
    matchedArtist: track.artists?.map((row) => row.name).join(", ") || undefined,
    durationSec: typeof track.duration_ms === "number" ? Math.round(track.duration_ms / 1000) : null,
    crowdScore: popularityToRating(track.popularity),
    genre: genreResult.genres[0] ?? null,
    bpm: typeof features?.tempo === "number" ? Math.round(features.tempo) : null,
    musicalKey: typeof features?.key === "number" && typeof features.mode === "number" ? spotifyKeyToString(features.key, features.mode) : null,
    energy: typeof features?.energy === "number" ? features.energy : null,
    danceability: typeof features?.danceability === "number" ? features.danceability : null,
    message: messages.join(" ") || undefined,
  };
}



