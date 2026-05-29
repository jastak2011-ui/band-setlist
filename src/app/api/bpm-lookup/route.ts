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
  singalongScore: z.number().nullable().optional(),
  peakHourScore: z.number().nullable().optional(),
  transitionFlexibility: z.number().nullable().optional(),
  audienceAgeAppeal: z.array(z.string()).nullable().optional(),
  femaleParticipationScore: z.number().nullable().optional(),
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
    const result = await lookupSongMetadata(parsed.data);
    return NextResponse.json({
      ...result,
      message: result.message ?? (result.bpm == null ? "BPM was not found from the shared enrichment lookup." : undefined),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
