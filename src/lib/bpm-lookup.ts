import { lookupBpmFromDeezer } from "./bpm-deezer";
import { lookupBpmFromSongBpm } from "./bpm-songbpm";
import { lookupBpmFromSpotify } from "./bpm-spotify";

export type UnifiedBpmResult = {
  bpm: number | null;
  energy: number | null;
  musicalKey: string | null;
  durationSec: number | null;
  source: "deezer" | "spotify" | "songbpm" | "none";
  spotifyTrackId?: string;
  deezerTrackId?: string;
  songBpmUrl?: string;
  message?: string;
};

/**
 * 1) Deezer public API (no keys).
 * 2) Spotify audio features if SPOTIFY_* env vars are set and Deezer did not yield BPM.
 * 3) SongBPM page lookup as a no-key fallback for predictable artist/title URLs.
 */
export async function lookupBpm(title: string, artist: string): Promise<UnifiedBpmResult> {
  const deezer = await lookupBpmFromDeezer(title, artist);

  if (deezer.bpm != null) {
    return {
      bpm: deezer.bpm,
      energy: null,
      musicalKey: null,
      durationSec: deezer.durationSec,
      source: "deezer",
      deezerTrackId: deezer.deezerTrackId,
      message: deezer.message,
    };
  }

  const spotify = await lookupBpmFromSpotify(title, artist);
  if (spotify.bpm != null || spotify.energy != null || spotify.musicalKey) {
    return {
      bpm: spotify.bpm,
      energy: spotify.energy,
      musicalKey: spotify.musicalKey,
      durationSec: spotify.durationSec,
      source: "spotify",
      spotifyTrackId: spotify.spotifyTrackId,
      message: spotify.message,
    };
  }

  const songBpm = await lookupBpmFromSongBpm(title, artist);
  if (songBpm.bpm != null) {
    return {
      bpm: songBpm.bpm,
      energy: null,
      musicalKey: songBpm.musicalKey,
      durationSec: songBpm.durationSec ?? deezer.durationSec ?? spotify.durationSec,
      source: "songbpm",
      songBpmUrl: songBpm.url,
      message: songBpm.message,
    };
  }

  const parts = [deezer.message, spotify.message, songBpm.message].filter(Boolean);
  return {
    bpm: null,
    energy: null,
    musicalKey: songBpm.musicalKey ?? null,
    durationSec: deezer.durationSec ?? spotify.durationSec ?? songBpm.durationSec,
    source: "none",
    songBpmUrl: songBpm.url,
    message: parts.join(" ") || "Could not resolve BPM from Deezer, Spotify, or SongBPM.",
  };
}