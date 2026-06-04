import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { query, querySongsByIds } from "@/lib/db";
import { getCrowdResponseStats } from "@/lib/recommendations";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5-nano";
const MAX_ANALYSIS_SONGS = 160;
const MAX_NOTE_LENGTH = 240;

const eventType = z.enum(["bar-crowd", "brewery", "private-party", "wedding", "corporate-event"]);

const bodySchema = z.object({
  bandId: z.string().optional(),
  venueId: z.string().optional(),
  bandName: z.string().optional(),
  venueName: z.string().optional(),
  eventType: eventType.optional(),
  performedAt: z.string().optional(),
  numSets: z.number().int().min(1).max(12),
  targetDurationSec: z.number().int().positive().optional(),
  sets: z.array(z.object({
    index: z.number().int().min(1),
    songIds: z.array(z.string()).min(1),
  })).min(1),
});

const aiAnalysisSchema = z.object({
  overallRating: z.number().min(1).max(10),
  summary: z.string(),
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  recommendedMoves: z.array(z.string()).default([]),
  suggestedOpener: z.string().nullable().default(null),
  suggestedCloser: z.string().nullable().default(null),
  suggestedSetBreak: z.string().nullable().default(null),
  energyFlowNotes: z.array(z.string()).default([]),
  vocalFatigueNotes: z.array(z.string()).default([]),
  venueFitNotes: z.array(z.string()).default([]),
  songsToWatch: z.array(z.string()).default([]),
});

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string") return direct.trim();
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.map((part) => {
        if (!part || typeof part !== "object") return "";
        return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
      });
    })
    .join("\n")
    .trim();
}

function rawDebugSnippet(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2).slice(0, 1000);
  } catch {
    return String(payload).slice(0, 1000);
  }
}

function parseJsonText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function safeShortNote(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_NOTE_LENGTH) return undefined;
  if ((trimmed.match(/\n/g) ?? []).length > 3) return undefined;
  return trimmed;
}

function formatDate(value: string | undefined) {
  if (!value) return undefined;
  return value.slice(0, 10);
}

async function lookupName(table: "bands" | "venues", id: string | undefined) {
  if (!id) return null;
  const result = await query(`SELECT name FROM ${table} WHERE id = $1`, [id]);
  return typeof result.rows[0]?.name === "string" ? result.rows[0].name as string : null;
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return privateJson({ ok: false, error: "OPENAI_API_KEY is not configured" });
    }

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return privateJson({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    if (input.bandId) await requireBandAccess(user, input.bandId);
    if (input.venueId && !input.bandId && user.role !== "admin") {
      return privateJson({ ok: false, error: "bandId required" }, { status: 400 });
    }

    const orderedIds = input.sets.flatMap((set) => set.songIds);
    const uniqueIds = [...new Set(orderedIds)];
    const rows = await querySongsByIds(uniqueIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const crowdStats = input.venueId ? await getCrowdResponseStats(input.venueId, input.bandId) : new Map();
    const bandName = input.bandName || await lookupName("bands", input.bandId) || "Unspecified band";
    const venueName = input.venueName || await lookupName("venues", input.venueId) || "Unspecified venue";

    let includedCount = 0;
    const sets = input.sets.map((set) => ({
      index: set.index,
      songs: set.songIds.flatMap((id, songIndex) => {
        if (includedCount >= MAX_ANALYSIS_SONGS) return [];
        const song = byId.get(id);
        if (!song) return [];
        includedCount += 1;
        const stats = crowdStats.get(id);
        return [{
          position: songIndex + 1,
          title: song.title,
          artist: song.artist,
          bpm: song.bpm,
          durationSec: song.durationSec,
          key: song.musicalKey,
          genre: song.genre,
          energy: song.energy,
          singalongScore: song.singalongScore,
          danceability: song.danceability,
          crowdFamiliarity: song.crowdScore,
          femaleParticipationScore: song.femaleParticipationScore,
          peakHourScore: song.peakHourScore,
          transitionFlexibility: song.transitionFlexibility,
          vocalDifficulty: song.vocalDifficulty,
          openerCandidate: song.openerCandidate,
          closerCandidate: song.closerCandidate,
          venueSpecificCrowdResponse: stats?.venueAverage == null ? null : {
            average: Number(stats.venueAverage.toFixed(1)),
            count: stats.venueCount,
          },
          notes: safeShortNote(song.notes),
        }];
      }),
    }));

    const context = {
      bandName,
      venueName,
      buildSetFor: input.eventType ?? "bar-crowd",
      performanceDate: formatDate(input.performedAt),
      numberOfSets: input.numSets,
      targetDurationSec: input.targetDurationSec ?? null,
      songCountSent: includedCount,
      songCountTotal: orderedIds.length,
      sets,
      instructions: [
        "Analyze only. Do not reorder the setlist.",
        "Give practical live-performance feedback for a working band.",
        "If recommending moves, describe them as suggestions only.",
        "Return only JSON with the requested fields.",
      ],
    };

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: "You are a practical live music setlist analyst. Return only valid concise JSON. Do not use markdown.",
          },
          {
            role: "user",
            content: `Analyze this setlist context and return JSON with exactly these fields: overallRating number 1-10, summary string, strengths string[], concerns string[], recommendedMoves string[], suggestedOpener string|null, suggestedCloser string|null, suggestedSetBreak string|null, energyFlowNotes string[], vocalFatigueNotes string[], venueFitNotes string[], songsToWatch string[]. Do not include long explanations. Do not use markdown. Return only valid JSON. Keep each array to max 5 items. Keep each item under 160 characters.\n\n${JSON.stringify(context)}`,
          },
        ],
        max_output_tokens: 4000,
      }),
    });

    const payload = await response.json().catch(() => null);
    console.info("OpenAI analyze-set raw response", payload);
    console.info("OpenAI analyze-set response.output", payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined);
    console.info("OpenAI analyze-set response.output_text", payload && typeof payload === "object" ? (payload as { output_text?: unknown }).output_text : undefined);
    if (payload && typeof payload === "object") {
      const output = (payload as { output?: unknown }).output;
      if (Array.isArray(output)) {
        const contentBlocks = output.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const content = (item as { content?: unknown }).content;
          return Array.isArray(content) ? content : [];
        });
        console.info("OpenAI analyze-set content blocks", contentBlocks);
      }
    }
    if (!response.ok) {
      const error =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as { error?: { message?: string } }).error?.message
          : null;
      return privateJson({ ok: false, error: error || `OpenAI analysis failed (${response.status})`, debugRawResponse: rawDebugSnippet(payload) }, { status: response.status });
    }

    if (payload && typeof payload === "object" && (payload as { status?: unknown }).status === "incomplete") {
      const incompleteDetails = (payload as { incomplete_details?: { reason?: unknown } }).incomplete_details;
      return privateJson({
        ok: false,
        error: "AI analysis was cut off before completion. Try fewer songs or run again.",
        incompleteReason: typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : null,
        debugRawResponse: rawDebugSnippet(payload),
      }, { status: 502 });
    }

    const text = extractResponseText(payload);
    if (!text) return privateJson({ ok: false, error: "OpenAI returned an empty analysis.", debugRawResponse: rawDebugSnippet(payload) }, { status: 502 });

    let analysis: unknown;
    try {
      analysis = parseJsonText(text);
    } catch {
      return privateJson({ ok: false, error: "OpenAI returned analysis that was not valid JSON.", debugRawResponse: rawDebugSnippet(payload) }, { status: 502 });
    }

    const validated = aiAnalysisSchema.safeParse(analysis);
    if (!validated.success) {
      return privateJson({ ok: false, error: "OpenAI returned analysis in an unexpected format.", debugRawResponse: rawDebugSnippet(payload) }, { status: 502 });
    }

    return privateJson({ ok: true, analysis: validated.data });
  } catch (error) {
    return authErrorResponse(error);
  }
}
