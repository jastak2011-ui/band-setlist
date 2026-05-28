import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { lookupSongMetadata } from "@/lib/metadata-lookup";

const body = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  artist: z.string().min(1),
  bpm: z.number().nullable().optional(),
  musicalKey: z.string().nullable().optional(),
  durationSec: z.number().nullable().optional(),
  energy: z.number().nullable().optional(),
  genre: z.string().nullable().optional(),
  vibe: z.string().nullable().optional(),
  crowdScore: z.number().nullable().optional(),
  danceability: z.number().nullable().optional(),
  vocalDifficulty: z.number().nullable().optional(),
  openerCandidate: z.boolean().nullable().optional(),
  closerCandidate: z.boolean().nullable().optional(),
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
  const result = await lookupSongMetadata(parsed.data);
  console.info("Metadata lookup response", {
    title: parsed.data.title,
    artist: parsed.data.artist,
    source: result.source,
    matchedTitle: result.matchedTitle,
    matchedArtist: result.matchedArtist,
    foundFields: result.proposals.map((proposal) => proposal.field),
    missingFields: result.unavailable.map((proposal) => proposal.field),
    message: result.message,
  });

  return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
