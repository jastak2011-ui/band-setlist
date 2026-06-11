import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { query, querySongsByIds } from "@/lib/db";
import { getCrowdResponseStats } from "@/lib/recommendations";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5-nano";
const MAX_ANALYSIS_SONGS = 160;

const eventType = z.enum(["bar-crowd", "brewery", "private-party", "wedding", "corporate-event"]);
const compactSongSchema = z.object({
  songId: z.string(),
  setNumber: z.number().int().min(1).optional(),
  position: z.number().int().min(1).optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  bpm: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  key: z.string().nullable().optional(),
  genre: z.string().nullable().optional(),
  energy: z.number().nullable().optional(),
  singalongScore: z.number().nullable().optional(),
  danceability: z.number().nullable().optional(),
  crowdFamiliarity: z.number().nullable().optional(),
  femaleParticipationScore: z.number().nullable().optional(),
  peakHourScore: z.number().nullable().optional(),
  transitionFlexibility: z.number().nullable().optional(),
  vocalDifficulty: z.number().nullable().optional(),
  openerCandidate: z.boolean().nullable().optional(),
  closerCandidate: z.boolean().nullable().optional(),
  crowdResponseScore: z.number().nullable().optional(),
});

const bodySchema = z.object({
  setlistId: z.string().optional(),
  bandId: z.string().optional(),
  venueId: z.string().optional(),
  bandName: z.string().optional(),
  venueName: z.string().optional(),
  venueType: z.string().optional(),
  crowdSetup: z.string().optional(),
  eventType: eventType.optional(),
  performedAt: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  numSets: z.number().int().min(1).max(12),
  targetDurationSec: z.number().int().positive().optional(),
  sets: z.array(z.object({
    index: z.number().int().min(1),
    songIds: z.array(z.string()).min(1).optional(),
    songs: z.array(compactSongSchema).min(1).optional(),
  })).min(1),
});

const aiAnalysisSchema = z.object({
  overallRating: z.coerce.number().min(1).max(10).default(5),
  summary: z.string().default("AI returned a partial set analysis."),
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
  orderStrategySummary: z.string().default("AI evaluated the current order and recommended a sequence."),
  orderChangeSummary: z.object({
    changed: z.boolean().default(false),
    songsMoved: z.coerce.number().int().min(0).default(0),
    reason: z.string().default("No order change explanation returned."),
  }).default({ changed: false, songsMoved: 0, reason: "No order change explanation returned." }),
  recommendedOrder: z.array(z.object({
    songId: z.string(),
    setNumber: z.number().int().min(1),
    position: z.number().int().min(1),
  })).default([]),
  orderReasons: z.record(z.string()).default({}),
  recommendedOrderWarning: z.string().nullable().optional(),
  recommendedOrderProblems: z.array(z.string()).default([]),
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
  if (fenced) return JSON.parse(fenced[1]);
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonText = extractFirstJsonObject(trimmed);
    if (!jsonText) throw new Error("No JSON object found.");
    return JSON.parse(jsonText);
  }
}

function extractFirstJsonObject(text: string) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function formatDate(value: string | undefined) {
  if (!value) return undefined;
  return value.slice(0, 10);
}

function timeOfDayLabel(startTime: string | undefined) {
  if (!startTime) return null;
  const hour = Number(startTime.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour < 17) return "afternoon";
  if (hour < 21) return "early evening";
  return "late night";
}

async function lookupName(table: "bands" | "venues", id: string | undefined) {
  if (!id) return null;
  const result = await query(`SELECT name FROM ${table} WHERE id = $1`, [id]);
  return typeof result.rows[0]?.name === "string" ? result.rows[0].name as string : null;
}

function idsForSet(set: z.infer<typeof bodySchema>["sets"][number]) {
  return set.songs?.map((song) => song.songId) ?? set.songIds ?? [];
}

function compactClientSongById(input: z.infer<typeof bodySchema>) {
  const entries = input.sets.flatMap((set) => set.songs ?? []);
  return new Map(entries.map((song) => [song.songId, song]));
}

function repairRecommendedOrder(
  analysis: z.infer<typeof aiAnalysisSchema>,
  expectedSongIds: string[],
  numSets: number,
  input: z.infer<typeof bodySchema>,
) {
  const expected = new Set(expectedSongIds);
  const seen = new Set<string>();
  const problems: string[] = [];
  const currentPosition = new Map<string, { setNumber: number; order: number }>();
  input.sets.forEach((set, setIndex) => {
    idsForSet(set).forEach((songId, songIndex) => {
      if (!currentPosition.has(songId)) currentPosition.set(songId, { setNumber: set.index, order: (setIndex * 1000) + songIndex });
    });
  });
  const validItems: Array<{ songId: string; setNumber: number; position: number }> = [];

  for (const item of [...analysis.recommendedOrder].sort((a, b) => a.setNumber - b.setNumber || a.position - b.position)) {
    if (!expected.has(item.songId)) {
      problems.push(`Unknown songId: ${item.songId}`);
      continue;
    }
    if (seen.has(item.songId)) {
      problems.push(`Duplicate songId: ${item.songId}`);
      continue;
    }
    if (item.setNumber < 1 || item.setNumber > numSets) {
      problems.push(`Invalid set number for songId ${item.songId}: Set ${item.setNumber}`);
      continue;
    }
    seen.add(item.songId);
    validItems.push(item);
  }

  if (problems.length > 0) {
    return {
      ...analysis,
      recommendedOrderWarning: "AI returned analysis but the recommended order had invalid song IDs.",
      recommendedOrderProblems: problems.slice(0, 12),
    };
  }

  const missingSongIds = expectedSongIds.filter((songId) => !seen.has(songId));
  if (missingSongIds.length === 0) return analysis;

  const repaired = [...validItems];
  for (const songId of missingSongIds) {
    const current = currentPosition.get(songId);
    repaired.push({
      songId,
      setNumber: Math.min(numSets, Math.max(1, current?.setNumber ?? numSets)),
      position: 1_000_000 + (current?.order ?? 0),
    });
  }

  const perSetPosition = new Map<number, number>();
  const normalized = repaired
    .sort((a, b) => a.setNumber - b.setNumber || a.position - b.position)
    .map((item) => {
      const nextPosition = (perSetPosition.get(item.setNumber) ?? 0) + 1;
      perSetPosition.set(item.setNumber, nextPosition);
      return { songId: item.songId, setNumber: item.setNumber, position: nextPosition };
    });

  return {
    ...analysis,
    recommendedOrder: normalized,
    recommendedOrderWarning: "AI returned a partial order; missing songs were appended in current order.",
    recommendedOrderProblems: missingSongIds.slice(0, 12).map((songId) => `Appended missing songId: ${songId}`),
  };
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

    const orderedIds = input.sets.flatMap(idsForSet);
    const uniqueIds = [...new Set(orderedIds)];
    const rows = await querySongsByIds(uniqueIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const clientSongs = compactClientSongById(input);
    const crowdStats = input.venueId ? await getCrowdResponseStats(input.venueId, input.bandId) : new Map();
    const bandName = input.bandName || await lookupName("bands", input.bandId) || "Unspecified band";
    const venueName = input.venueName || await lookupName("venues", input.venueId) || "Unspecified venue";

    let includedCount = 0;
    const sets = input.sets.map((set) => ({
      index: set.index,
      songs: idsForSet(set).flatMap((id, songIndex) => {
        if (includedCount >= MAX_ANALYSIS_SONGS) return [];
        const song = byId.get(id);
        if (!song) return [];
        includedCount += 1;
        const stats = crowdStats.get(id);
        const clientSong = clientSongs.get(id);
        return [{
          songId: song.id,
          setNumber: set.index,
          position: songIndex + 1,
          title: song.title,
          artist: song.artist,
          bpm: song.bpm,
          duration: song.durationSec,
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
          crowdResponseScore: clientSong?.crowdResponseScore ?? null,
          venueSpecificCrowdResponse: stats?.venueAverage == null ? null : {
            average: Number(stats.venueAverage.toFixed(1)),
            count: stats.venueCount,
          },
        }];
      }),
    }));

    const context = {
      bandName,
      venueName,
      venueType: input.venueType ?? null,
      crowdSetup: input.crowdSetup ?? null,
      setlistId: input.setlistId ?? null,
      buildSetFor: input.eventType ?? "bar-crowd",
      performanceDate: formatDate(input.performedAt),
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      timeOfDay: timeOfDayLabel(input.startTime),
      numberOfSets: input.numSets,
      targetDurationSec: input.targetDurationSec ?? null,
      songCountSent: includedCount,
      songCountTotal: orderedIds.length,
      sets,
      instructions: [
        "Analyze only. Recommend an alternate order, but do not claim the setlist has been changed.",
        "Recommend a complete alternate order using only the songs provided.",
        "Preserve the requested number of sets.",
        "Use every provided song exactly once in recommendedOrder.",
        "Each recommendedOrder item must include only songId, setNumber, and position.",
        "Put optional notable placement reasons in orderReasons by songId.",
        "Do not simply return the current order unless it is genuinely the best order.",
        "If keeping the same order, explain why in orderChangeSummary.reason.",
        "Consider venue type, crowd setup, start time, end time, and time of day.",
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
            content: "You are a practical live music setlist analyst. Return only valid JSON. No markdown, comments, or prose outside JSON.",
          },
          {
            role: "user",
            content: `Analyze this setlist context and return one valid JSON object only. No markdown. No comments. No prose outside JSON. Required fields: overallRating number 1-10, summary string, strengths string[], concerns string[], recommendedMoves string[], suggestedOpener string|null, suggestedCloser string|null, suggestedSetBreak string|null, energyFlowNotes string[], vocalFatigueNotes string[], venueFitNotes string[], songsToWatch string[], orderStrategySummary string, orderChangeSummary object, recommendedOrder array, orderReasons object.

order strategy rules:
- Evaluate whether a stronger sequence exists.
- Do not simply return the current order unless it is genuinely the best order.
- Prefer making meaningful improvements when pacing, opener/closer, vocal fatigue, BPM flow, or venue fit can improve.
- If keeping the same order, explain why in orderChangeSummary.reason.
- orderChangeSummary shape: {"changed":true,"songsMoved":0,"reason":"..."}

recommendedOrder rules:
- Each item must be compact: {"songId":"...","setNumber":1,"position":1}
- Do not include title, artist, BPM, or reason inside recommendedOrder.
- recommendedOrder must include every provided songId exactly once.
- Do not omit songs.
- Do not invent songIds.
- Do not stop early.
- If unsure, still place every song.
- Preserve the selected number of sets.

orderReasons rules:
- Optional object keyed by songId.
- Only include opener, closer, set break transition songs, and top 5 notable placement reasons.
- Do not provide a reason for every song.
- Each reason under 140 characters.

Consider venue type, crowd setup, time of day, event preset, target duration, BPM flow, energy flow, singalong placement, female participation, crowd familiarity, peak-hour score, vocal fatigue, opener/closer candidates, avoid same artist back-to-back, avoid same genre back-to-back, avoid big BPM drops, and the already-filtered song pool. Mention venue type, seated/standing/mixed crowd posture, and gig time in Venue Fit or Energy Flow when relevant. Consider whether the gig likely starts as background music and builds later, whether early songs should be lower intensity, and whether late songs should lean higher singalong/dance/anthem material. Keep output concise: max 4 strengths, max 4 concerns, max 4 recommendedMoves, max 4 items in every other note array.\n\n${JSON.stringify(context)}`,
          },
        ],
        max_output_tokens: 6000,
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
      return privateJson({ ok: false, error: error || `OpenAI analysis failed (${response.status})`, debugRawResponse: rawDebugSnippet(payload) });
    }

    if (payload && typeof payload === "object" && (payload as { status?: unknown }).status === "incomplete") {
      const incompleteDetails = (payload as { incomplete_details?: { reason?: unknown } }).incomplete_details;
      return privateJson({
        ok: false,
        error: "AI analysis was too long to complete. Try again or use fewer songs.",
        incompleteReason: typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : null,
        debugRawResponse: rawDebugSnippet(payload),
      });
    }

    const text = extractResponseText(payload);
    if (!text) return privateJson({ ok: false, error: "OpenAI returned no final analysis text.", debugRawResponse: rawDebugSnippet(payload) });

    let analysis: unknown;
    try {
      analysis = parseJsonText(text);
    } catch {
      return privateJson({ ok: false, error: "OpenAI returned analysis that was not valid JSON.", debugRawResponse: rawDebugSnippet(payload) });
    }

    const validated = aiAnalysisSchema.safeParse(analysis);
    if (!validated.success) {
      return privateJson({ ok: false, error: "OpenAI returned analysis in an unexpected format.", details: validated.error.flatten(), debugRawResponse: rawDebugSnippet(payload) });
    }

    return privateJson({ ok: true, analysis: repairRecommendedOrder(validated.data, orderedIds, input.numSets, input) });
  } catch (error) {
    try {
      return authErrorResponse(error);
    } catch {
      return privateJson({ ok: false, error: error instanceof Error ? error.message : "AI analysis failed." }, { status: 500 });
    }
  }
}
