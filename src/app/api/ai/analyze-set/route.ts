import { z } from "zod";
import { authErrorResponse, privateJson, requireBandAccess, requireUser } from "@/lib/auth";
import { query, querySongsByIds } from "@/lib/db";
import { getCrowdResponseStats } from "@/lib/recommendations";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5-nano";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const MAX_ANALYSIS_SONGS = 160;
const SYSTEM_PROMPT = "You are a practical live music setlist analyst. Return only valid JSON. No markdown, comments, or prose outside JSON.";

type AiProvider = "openai" | "anthropic";

const eventType = z.enum(["bar-crowd", "brewery", "restaurant", "outdoor", "private-party", "wedding", "corporate-event"]);
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
  provider: z.enum(["openai", "anthropic"]).optional(),
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
  lockedGroups: z.array(z.object({
    groupId: z.string(),
    songIds: z.array(z.string()).min(2),
    title: z.string(),
  })).optional(),
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

function extractOpenAIResponseText(payload: unknown) {
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

function extractAnthropicResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text"
        ? (block as { text?: string }).text ?? ""
        : "",
    )
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

function parseResponseJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function providerErrorMessage(payload: unknown, fallbackBody: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
      const type = (error as { type?: unknown }).type;
      if (typeof type === "string" && type.trim()) return type;
    }
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallbackBody.trim().slice(0, 1000);
}

function resolveAiProvider(value?: string): AiProvider | null {
  const resolved = (value || process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  if (resolved === "openai" || resolved === "anthropic") return resolved;
  return null;
}

function buildAnalysisPrompt(context: unknown) {
  return `Analyze this setlist context and return one valid JSON object only. No markdown. No comments. No prose outside JSON. Required fields: overallRating number 1-10, summary string, strengths string[], concerns string[], recommendedMoves string[], suggestedOpener string|null, suggestedCloser string|null, suggestedSetBreak string|null, energyFlowNotes string[], vocalFatigueNotes string[], venueFitNotes string[], songsToWatch string[], orderStrategySummary string, orderChangeSummary object, recommendedOrder array, orderReasons object.

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
- Locked groups represent medleys or required transitions. Do not split locked groups. Keep songs in each locked group adjacent. Preserve their internal order. Treat each locked group as one sequencing unit.

orderReasons rules:
- Optional object keyed by songId.
- Only include opener, closer, set break transition songs, and top 5 notable placement reasons.
- Do not provide a reason for every song.
- Each reason under 140 characters.

Consider venue type, crowd setup, start/end time, time of day, overnightGig, expected audience engagement level, event preset, target duration, BPM flow, energy flow, singalong placement, female participation, crowd familiarity, peak-hour score, vocal fatigue, opener/closer candidates, avoid same artist back-to-back, avoid same genre back-to-back, avoid big BPM drops, and the already-filtered song pool. Mention venue type, seated/standing/mixed crowd posture, and gig time in Venue Fit, Energy Flow, Recommended Moves, Suggested Opener, or Suggested Closer when relevant. If overnightGig is true, treat the gig as late-night and crossing midnight, with stronger late-set singalong/dance/anthem material when suitable. Venue guidance: Restaurant means conversation-friendly early pacing, gradual energy build, familiar songs, and avoid peaking too early. Outdoor means attention is harder to capture, so familiar songs, singalongs, and a strong opener matter, with energy able to ramp sooner. Bar Crowd can handle higher energy earlier. Brewery should feel casual/social and build engagement through the night. Private Party should balance familiarity and variety. Wedding should prioritize broad familiarity, danceability, and singalong moments. Corporate Event should use conservative early pacing and broad appeal. Keep output concise: max 4 strengths, max 4 concerns, max 4 recommendedMoves, max 4 items in every other note array.\n\n${JSON.stringify(context)}`;
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

function minutesFromTime(value: string | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function crossesMidnight(startTime: string | undefined, endTime: string | undefined) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  return start != null && end != null && end < start;
}

function timeOfDayLabel(startTime: string | undefined, endTime?: string | undefined) {
  if (crossesMidnight(startTime, endTime)) return "Late Night / Overnight";
  if (!startTime) return null;
  const startMinutes = minutesFromTime(startTime);
  if (startMinutes == null) return null;
  const hour = Math.floor(startMinutes / 60);
  if (hour < 17) return "Afternoon";
  if (hour < 19) return "Early Evening";
  if (hour < 22) return "Prime Time Evening";
  return "Late Night";
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
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return privateJson({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const provider = resolveAiProvider(input.provider);
    if (!provider) {
      return privateJson({ ok: false, error: `Unsupported AI provider: ${input.provider ?? process.env.AI_PROVIDER}` }, { status: 400 });
    }
    const model = provider === "anthropic" ? ANTHROPIC_MODEL : OPENAI_MODEL;
    const apiKey = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return privateJson({ ok: false, error: provider === "anthropic" ? "Anthropic API key missing" : "OpenAI API key missing" });
    }
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
      timeOfDay: timeOfDayLabel(input.startTime, input.endTime),
      overnightGig: crossesMidnight(input.startTime, input.endTime),
      numberOfSets: input.numSets,
      targetDurationSec: input.targetDurationSec ?? null,
      songCountSent: includedCount,
      songCountTotal: orderedIds.length,
      lockedGroups: input.lockedGroups ?? [],
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
        "If overnightGig is true, treat the set as a late-night gig crossing midnight.",
        "Apply venue guidance: Restaurant should start conversation-friendly and build gradually; Outdoor needs a strong familiar opener and can ramp sooner; Bar Crowd can start with higher energy; Brewery should feel social and familiar while building through the night; Private Party should balance familiarity and variety; Wedding should prioritize broad familiarity, danceability, and singalong moments; Corporate Event should start conservatively with broad appeal.",
        "Give practical live-performance feedback for a working band.",
        "If recommending moves, describe them as suggestions only.",
        "Return only JSON with the requested fields.",
        "Locked groups are medleys or required transitions. Never split them; preserve internal order and keep the songs adjacent.",
      ],
    };

    const prompt = buildAnalysisPrompt(context);
    const response = provider === "anthropic"
      ? await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 6000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      })
      : await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: "low" },
          input: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_output_tokens: 6000,
        }),
      });

    const providerLabel = provider === "anthropic" ? "Anthropic" : "OpenAI";
    const responseBody = await response.text().catch(() => "");
    const payload = parseResponseJson(responseBody);
    if (provider === "anthropic" && !response.ok) {
      console.error("Anthropic analyze-set non-2xx response", {
        status: response.status,
        statusText: response.statusText,
        model,
        body: responseBody,
      });
    }
    console.info(`${providerLabel} analyze-set raw response`, payload);
    console.info(`${providerLabel} analyze-set response.output`, payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined);
    console.info(`${providerLabel} analyze-set response.output_text`, payload && typeof payload === "object" ? (payload as { output_text?: unknown }).output_text : undefined);
    if (payload && typeof payload === "object") {
      const output = (payload as { output?: unknown }).output;
      if (Array.isArray(output)) {
        const contentBlocks = output.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const content = (item as { content?: unknown }).content;
          return Array.isArray(content) ? content : [];
        });
        console.info(`${providerLabel} analyze-set content blocks`, contentBlocks);
      }
      if (provider === "anthropic") console.info("Anthropic analyze-set content blocks", (payload as { content?: unknown }).content);
    }
    if (!response.ok) {
      const message = providerErrorMessage(payload, responseBody);
      return privateJson({
        ok: false,
        provider,
        model,
        status: response.status,
        statusText: response.statusText,
        providerErrorMessage: message,
        error: `${providerLabel} analysis failed: ${message || `HTTP ${response.status}`}`,
        debugRawResponse: rawDebugSnippet(payload ?? responseBody),
      });
    }

    if (provider === "openai" && payload && typeof payload === "object" && (payload as { status?: unknown }).status === "incomplete") {
      const incompleteDetails = (payload as { incomplete_details?: { reason?: unknown } }).incomplete_details;
      return privateJson({
        ok: false,
        error: "AI analysis was too long to complete. Try again or use fewer songs.",
        incompleteReason: typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : null,
        debugRawResponse: rawDebugSnippet(payload),
      });
    }
    if (provider === "anthropic" && payload && typeof payload === "object" && (payload as { stop_reason?: unknown }).stop_reason === "max_tokens") {
      return privateJson({
        ok: false,
        error: "AI analysis was too long to complete. Try again or use fewer songs.",
        incompleteReason: "max_tokens",
        debugRawResponse: rawDebugSnippet(payload),
      });
    }

    const text = provider === "anthropic" ? extractAnthropicResponseText(payload) : extractOpenAIResponseText(payload);
    if (!text) return privateJson({ ok: false, error: `${providerLabel} returned no final analysis text.`, debugRawResponse: rawDebugSnippet(payload) });

    let analysis: unknown;
    try {
      analysis = parseJsonText(text);
    } catch {
      return privateJson({ ok: false, error: `${providerLabel} returned analysis that was not valid JSON.`, debugRawResponse: rawDebugSnippet(payload) });
    }

    const validated = aiAnalysisSchema.safeParse(analysis);
    if (!validated.success) {
      return privateJson({ ok: false, error: `${providerLabel} returned analysis in an unexpected format.`, details: validated.error.flatten(), debugRawResponse: rawDebugSnippet(payload) });
    }

    return privateJson({ ok: true, provider, model, analysis: repairRecommendedOrder(validated.data, orderedIds, input.numSets, input) });
  } catch (error) {
    try {
      return authErrorResponse(error);
    } catch {
      return privateJson({ ok: false, error: error instanceof Error ? error.message : "AI analysis failed." }, { status: 500 });
    }
  }
}
