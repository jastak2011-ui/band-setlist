import { NextResponse } from "next/server";
import { z } from "zod";
import { lookupSpotifySmartData } from "@/lib/spotify-smart-lookup";

const body = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  console.info("Spotify smart lookup request", { title: parsed.data.title, artist: parsed.data.artist });
  const result = await lookupSpotifySmartData(parsed.data.title, parsed.data.artist);
  console.info("Spotify smart lookup response", {
    title: parsed.data.title,
    artist: parsed.data.artist,
    source: result.source,
    matchedTitle: result.matchedTitle,
    matchedArtist: result.matchedArtist,
    hasDuration: result.durationSec != null,
    hasCrowdScore: result.crowdScore != null,
    hasGenre: Boolean(result.genre),
    hasAudioFeatures: result.bpm != null || result.energy != null || result.danceability != null || Boolean(result.musicalKey),
    message: result.message,
  });
  const status = result.source === "none" ? 400 : 200;
  return NextResponse.json(result, { status });
}

