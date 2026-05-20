import "server-only";

export type BpmLookupResult = {
  bpm: number | null;
  energy: number | null;
  musicalKey: string | null;
  durationSec: number | null;
  source: "spotify" | "none";
  spotifyTrackId?: string;
  message?: string;
};

function basicAuthHeader(id: string, secret: string): string {
  const token = Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

/**
 * Spotify metadata lookup is intentionally server-only and uses Client Credentials only.
 * This app does not request user authorization, scopes, redirects, refresh tokens, playback,
 * or account access. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in `.env.local`.
 */
export async function lookupBpmFromSpotify(
  title: string,
  artist: string,
): Promise<BpmLookupResult> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    return {
      bpm: null,
      energy: null,
      musicalKey: null,
      durationSec: null,
      source: "none",
    };
  }

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(id, secret),
    },
    // Client Credentials flow only: no scopes, redirect URI, code exchange, or user login.
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!tokenRes.ok) {
    return {
      bpm: null,
      energy: null,
      musicalKey: null,
      durationSec: null,
      source: "none",
      message: `Spotify token error (${tokenRes.status})`,
    };
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const access = tokenJson.access_token;
  if (!access) {
    return {
      bpm: null,
      energy: null,
      musicalKey: null,
      durationSec: null,
      source: "none",
      message: "Spotify token response missing access_token",
    };
  }

  const q = `track:${title} artist:${artist}`;
  const searchUrl = new URL("https://api.spotify.com/v1/search");
  searchUrl.searchParams.set("q", q);
  searchUrl.searchParams.set("type", "track");
  searchUrl.searchParams.set("limit", "3");

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${access}` },
  });

  if (!searchRes.ok) {
    return {
      bpm: null,
      energy: null,
      musicalKey: null,
      durationSec: null,
      source: "none",
      message: `Spotify search failed (${searchRes.status})`,
    };
  }

  const searchJson = (await searchRes.json()) as {
    tracks?: { items?: { id: string }[] };
  };
  const trackId = searchJson.tracks?.items?.[0]?.id;
  if (!trackId) {
    return {
      bpm: null,
      energy: null,
      musicalKey: null,
      durationSec: null,
      source: "none",
      message: "No Spotify track match for that title/artist.",
    };
  }

  const featRes = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
    headers: { Authorization: `Bearer ${access}` },
  });

  if (!featRes.ok) {
    return {
      bpm: null,
      energy: null,
      musicalKey: null,
      durationSec: null,
      source: "none",
      message: `Spotify audio-features failed (${featRes.status})`,
    };
  }

  const feat = (await featRes.json()) as {
    tempo?: number;
    energy?: number;
    key?: number;
    mode?: number;
    duration_ms?: number;
  };

  const bpm = typeof feat.tempo === "number" ? Math.round(feat.tempo) : null;
  const energy = typeof feat.energy === "number" ? feat.energy : null;
  const durationSec =
    typeof feat.duration_ms === "number" ? Math.round(feat.duration_ms / 1000) : null;

  const musicalKey =
    typeof feat.key === "number" && typeof feat.mode === "number"
      ? spotifyKeyToString(feat.key, feat.mode)
      : null;

  return {
    bpm,
    energy,
    musicalKey,
    durationSec,
    source: "spotify",
    spotifyTrackId: trackId,
  };
}

const PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

function spotifyKeyToString(key: number, mode: number): string | null {
  if (key < 0 || key > 11) return null;
  const quality = mode === 1 ? "major" : "minor";
  return `${PITCH_CLASSES[key]} ${quality}`;
}


