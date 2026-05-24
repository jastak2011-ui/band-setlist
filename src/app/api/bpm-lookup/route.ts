import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { lookupBpm } from "@/lib/bpm-lookup";

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
    const result = await lookupBpm(parsed.data.title, parsed.data.artist);
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
