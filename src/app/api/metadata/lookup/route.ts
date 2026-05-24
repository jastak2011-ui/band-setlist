import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { lookupSongMetadata } from "@/lib/metadata-lookup";

const body = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
});

export async function POST(req: Request) {
  try {
  await requireUser();
  const json = await req.json();
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  console.info("Metadata lookup request", { title: parsed.data.title, artist: parsed.data.artist });
  const result = await lookupSongMetadata(parsed.data.title, parsed.data.artist);
  console.info("Metadata lookup response", {
    title: parsed.data.title,
    artist: parsed.data.artist,
    source: result.source,
    matchedTitle: result.matchedTitle,
    matchedArtist: result.matchedArtist,
    hasDuration: result.durationSec != null,
    hasCrowdScore: result.crowdScore != null,
    hasGenre: Boolean(result.genre),
    hasVibe: Boolean(result.vibe),
    message: result.message,
  });

  return NextResponse.json(result, { status: result.source === "none" ? 400 : 200 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
