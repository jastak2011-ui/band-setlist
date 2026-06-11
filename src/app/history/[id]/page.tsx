"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readArrayResponse, readObjectResponse } from "@/app/client-fetch";
import { PrintButton } from "@/app/print-button";

type Song = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  musicalKey: string | null;
  durationSec?: number | null;
  genre?: string | null;
  energy?: number | null;
  crowdScore?: number | null;
  danceability?: number | null;
  vocalDifficulty?: number | null;
  singalongScore?: number | null;
  peakHourScore?: number | null;
  transitionFlexibility?: number | null;
  femaleParticipationScore?: number | null;
  openerCandidate?: boolean | null;
  closerCandidate?: boolean | null;
  notes?: string | null;
  capoOrTuning?: string | null;
  lockedWithNext?: boolean;
  performanceRating?: {
    crowdResponseScore: number | null;
    notes: string | null;
    updatedAt?: string | null;
  } | null;
};

type ReplacementPrompt = {
  setIndex: number;
  songIndex: number;
  mode: "choices" | "list";
};
type DragLocation = {
  setIndex: number;
  songIndex: number;
};
type Detail = {
  setlist: {
    title: string | null;
    createdAt: string;
    performedAt: string | null;
    venueId?: string | null;
    venueName?: string | null;
    venueType?: string | null;
    crowdSetup?: string | null;
    bandId?: string | null;
    bandName?: string | null;
    startTime?: string | null;
    endTime?: string | null;
  };
  sets: { index: number; songs: Song[] }[];
};
type AiRecommendedOrderItem = { songId: string; setNumber: number; position: number };
type AiProvider = "openai" | "anthropic";
type AiSetAnalysis = {
  provider?: AiProvider;
  model?: string;
  overallRating: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendedMoves: string[];
  suggestedOpener: string | null;
  suggestedCloser: string | null;
  suggestedSetBreak: string | null;
  energyFlowNotes: string[];
  vocalFatigueNotes: string[];
  venueFitNotes: string[];
  songsToWatch: string[];
  orderStrategySummary?: string;
  orderChangeSummary?: { changed: boolean; songsMoved: number; reason: string };
  recommendedOrder: AiRecommendedOrderItem[];
  orderReasons?: Record<string, string>;
  recommendedOrderWarning?: string | null;
  recommendedOrderProblems?: string[];
};
type AiAnalysisResponse = {
  ok?: boolean;
  provider?: AiProvider;
  model?: string;
  status?: number;
  statusText?: string;
  providerErrorMessage?: string;
  analysis?: AiSetAnalysis;
  error?: unknown;
  incompleteReason?: string | null;
};
type AiOrderMove = { songId: string; title: string; from: string; to: string; distance: number };
type AiOrderComparison = { movedCount: number; unchangedCount: number; biggestMoves: AiOrderMove[] };
const crowdRatingOptions = [
  { label: "Blank", value: null },
  { label: "Poor", value: 3 },
  { label: "Okay", value: 5 },
  { label: "Good", value: 7 },
  { label: "Great", value: 10 },
] as const;

function normalizeNameForMatch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bthe\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSongKey(title: string, artist: string) {
  return `${normalizeNameForMatch(title)}::${normalizeNameForMatch(artist)}`;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function totalDuration(songs: { durationSec?: number | null }[]) {
  return songs.reduce((sum, song) => sum + (song.durationSec ?? 0), 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function gigWindow(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const [startHour, startMinute] = start.slice(0, 5).split(":").map(Number);
  const [endHour, endMinute] = end.slice(0, 5).split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
  let minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  if (minutes === 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const overnight = (endHour * 60 + endMinute) < (startHour * 60 + startMinute);
  return `${hours}h ${mins.toString().padStart(2, "0")}m${overnight ? " overnight" : ""}`;
}

function compareAiOrder(currentSets: Detail["sets"], recommendedOrder: AiRecommendedOrderItem[]): AiOrderComparison {
  const currentById = new Map<string, { title: string; setNumber: number; position: number; flatIndex: number }>();
  let currentIndex = 0;
  [...currentSets].sort((a, b) => a.index - b.index).forEach((set) => {
    set.songs.forEach((song, songIndex) => {
      currentById.set(song.id, {
        title: song.title,
        setNumber: set.index,
        position: songIndex + 1,
        flatIndex: currentIndex,
      });
      currentIndex += 1;
    });
  });

  let movedCount = 0;
  let unchangedCount = 0;
  const moves: AiOrderMove[] = [];
  [...recommendedOrder].sort((a, b) => a.setNumber - b.setNumber || a.position - b.position).forEach((item, index) => {
    const current = currentById.get(item.songId);
    if (!current) return;
    const moved = current.setNumber !== item.setNumber || current.position !== item.position;
    if (moved) {
      movedCount += 1;
      moves.push({
        songId: item.songId,
        title: current.title,
        from: `Set ${current.setNumber} #${current.position}`,
        to: `Set ${item.setNumber} #${item.position}`,
        distance: Math.abs(index - current.flatIndex),
      });
    } else {
      unchangedCount += 1;
    }
  });

  return { movedCount, unchangedCount, biggestMoves: moves.sort((a, b) => b.distance - a.distance).slice(0, 5) };
}

function shuffleSongs<T>(items: T[]) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function redistributeSongs(songs: Song[], count: number) {
  const sets = Array.from({ length: count }, (_, index) => ({ index: index + 1, songs: [] as Song[] }));
  songs.forEach((song, index) => {
    sets[index % count].songs.push(song);
  });
  return sets;
}

function renumberSets(sets: Detail["sets"]) {
  return sets.map((set, index) => ({ ...set, index: index + 1 }));
}

function normalizeLockedSongs(songs: Song[]) {
  return songs.map((song, index) => ({ ...song, lockedWithNext: index < songs.length - 1 ? Boolean(song.lockedWithNext) : false }));
}

function normalizeLockedSets(sets: Detail["sets"]) {
  return sets.map((set) => ({ ...set, songs: normalizeLockedSongs(set.songs) }));
}

function medleyGroupBounds(songs: Song[], songIndex: number) {
  let start = songIndex;
  while (start > 0 && songs[start - 1]?.lockedWithNext) start -= 1;
  let end = songIndex;
  while (end < songs.length - 1 && songs[end]?.lockedWithNext) end += 1;
  return { start, end, size: end - start + 1 };
}

function medleyGroupsForSet(set: { index: number; songs: Song[] }) {
  const groups: Array<{ groupId: string; songIds: string[]; title: string }> = [];
  let index = 0;
  while (index < set.songs.length) {
    const bounds = medleyGroupBounds(set.songs, index);
    if (bounds.size > 1) {
      const groupSongs = set.songs.slice(bounds.start, bounds.end + 1);
      groups.push({
        groupId: `set-${set.index}-medley-${bounds.start + 1}`,
        songIds: groupSongs.map((song) => song.id),
        title: groupSongs.map((song) => song.title).join(" / "),
      });
    }
    index = bounds.end + 1;
  }
  return groups;
}

function lockedGroupsForSets(sets: Detail["sets"]) {
  return sets.flatMap(medleyGroupsForSet);
}

function setPayload(sets: Detail["sets"]) {
  return normalizeLockedSets(sets).map((set) => set.songs.map((song, index) => ({
    songId: song.id,
    lockedWithNext: index < set.songs.length - 1 ? Boolean(song.lockedWithNext) : false,
  })));
}

function blockifySongs(songs: Song[]) {
  const blocks: Song[][] = [];
  let index = 0;
  while (index < songs.length) {
    const bounds = medleyGroupBounds(songs, index);
    blocks.push(songs.slice(bounds.start, bounds.end + 1));
    index = bounds.end + 1;
  }
  return blocks;
}

function songsFromBlocks(blocks: Song[][]) {
  return normalizeLockedSongs(blocks.flat());
}

function shuffleSongBlocks(songs: Song[]) {
  return songsFromBlocks(shuffleSongs(blockifySongs(songs)));
}

function findBlockIndexBySongIndex(blocks: Song[][], songIndex: number) {
  let cursor = 0;
  for (let index = 0; index < blocks.length; index++) {
    const size = blocks[index].length;
    if (songIndex >= cursor && songIndex < cursor + size) return index;
    cursor += size;
  }
  return -1;
}

function blockInsertIndexForSongIndex(blocks: Song[][], songIndex: number | "end") {
  if (songIndex === "end") return blocks.length;
  const index = findBlockIndexBySongIndex(blocks, songIndex);
  return index < 0 ? blocks.length : index;
}

function splitSongsEvenlyByCount(songs: Song[], count: number) {
  const setCount = Math.max(1, Math.min(4, count));
  const blocks = blockifySongs(songs);
  const base = Math.floor(blocks.length / setCount);
  const remainder = blocks.length % setCount;
  let cursor = 0;
  return normalizeLockedSets(Array.from({ length: setCount }, (_, index) => {
    const size = base + (index < remainder ? 1 : 0);
    const nextSongs = blocks.slice(cursor, cursor + size).flat();
    cursor += size;
    return { index: index + 1, songs: nextSongs };
  }));
}

function splitSongsEvenlyByDuration(songs: Song[], count: number) {
  const setCount = Math.max(1, Math.min(4, count));
  const totalSeconds = totalDuration(songs);
  if (totalSeconds <= 0) return splitSongsEvenlyByCount(songs, setCount);
  const targetSeconds = totalSeconds / setCount;
  const sets = Array.from({ length: setCount }, (_, index) => ({ index: index + 1, songs: [] as Song[] }));
  let setIndex = 0;
  let currentSeconds = 0;

  const blocks = blockifySongs(songs);
  blocks.forEach((block, blockIndex) => {
    const blockSeconds = totalDuration(block);
    const remainingBlocks = blocks.length - blockIndex;
    const remainingSets = setCount - setIndex;
    const shouldStartNextSet =
      sets[setIndex].songs.length > 0 &&
      setIndex < setCount - 1 &&
      remainingBlocks > remainingSets &&
      currentSeconds + blockSeconds > targetSeconds;

    if (shouldStartNextSet) {
      setIndex += 1;
      currentSeconds = 0;
    }

    sets[setIndex].songs.push(...block);
    currentSeconds += blockSeconds;
  });

  return normalizeLockedSets(sets);
}

function filenameFromDisposition(disposition: string | null) {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function SongPerformanceRating({ song, busy, onSave }: { song: Song; busy: boolean; onSave: (score: number | null) => void }) {
  const currentScore = song.performanceRating?.crowdResponseScore ?? null;

  return (
    <div className="col-start-4 col-span-2 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-[var(--text)]">Crowd Response</span>
        {crowdRatingOptions.map((option) => {
          const selected = currentScore === option.value;
          return (
          <button
            key={option.label}
            type="button"
            className={`btn h-8 px-2 py-0 text-xs ${selected ? "btn-primary" : "btn-ghost"}`}
            disabled={busy}
            onClick={() => {
              onSave(option.value);
            }}
          >
            {option.label}
          </button>
          );
        })}
        {busy && <span className="text-[var(--muted)]">Saving...</span>}
      </div>
    </div>
  );
}

function AiSetAnalysisPanel({ analysis, currentSongs, currentSets, onApplyOrder }: { analysis: AiSetAnalysis; currentSongs: Song[]; currentSets: Detail["sets"]; onApplyOrder: () => void }) {
  const byId = new Map(currentSongs.map((song) => [song.id, song]));
  const recommendedBySet = [...analysis.recommendedOrder].sort((a, b) => a.setNumber - b.setNumber || a.position - b.position);
  const orderComparison = compareAiOrder(currentSets, analysis.recommendedOrder);
  const keptSameOrder = analysis.recommendedOrder.length > 0 && orderComparison.movedCount === 0;

  return (
    <div className="no-print rounded-lg border border-[var(--border)] bg-[#0f131a]/50 px-3 py-3 text-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-[var(--accent)]">AI Set Analysis</h2>
          {(analysis.provider || analysis.model) && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Provider: {analysis.provider === "anthropic" ? "Anthropic" : "OpenAI"}{analysis.model ? ` · Model: ${analysis.model}` : ""}
            </p>
          )}
          <p className="mt-1 text-[var(--muted)]">{analysis.summary}</p>
        </div>
        <div className="rounded-md border border-[var(--border)] px-3 py-2 text-center">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Overall Rating</div>
          <div className="mt-1 text-lg font-semibold">{analysis.overallRating}/10</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AiAnalysisList title="Strengths" items={analysis.strengths} emptyText="No strengths returned." />
        <AiAnalysisList title="Concerns" items={analysis.concerns} emptyText="No concerns returned." />
        <AiAnalysisList title="Recommended Moves" items={analysis.recommendedMoves} emptyText="No moves recommended." />
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Suggested Opener / Closer / Set Break</h3>
          <dl className="mt-2 space-y-1 text-xs text-[var(--muted)]">
            <div><dt className="inline text-[var(--text)]">Opener: </dt><dd className="inline">{analysis.suggestedOpener || "No suggestion."}</dd></div>
            <div><dt className="inline text-[var(--text)]">Closer: </dt><dd className="inline">{analysis.suggestedCloser || "No suggestion."}</dd></div>
            <div><dt className="inline text-[var(--text)]">Set break: </dt><dd className="inline">{analysis.suggestedSetBreak || "No suggestion."}</dd></div>
          </dl>
        </div>
        <AiAnalysisList title="Energy Flow" items={analysis.energyFlowNotes} emptyText="No energy flow notes returned." />
        <AiAnalysisList title="Vocal Fatigue" items={analysis.vocalFatigueNotes} emptyText="No vocal fatigue notes returned." />
        <AiAnalysisList title="Venue Fit" items={analysis.venueFitNotes} emptyText="No venue fit notes returned." />
        <AiAnalysisList title="Songs To Watch" items={analysis.songsToWatch} emptyText="No songs flagged." />
      </div>

      <div className="mt-5 rounded-lg border border-[var(--border)] px-3 py-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium text-[var(--accent)]">AI Recommended Order</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">Applying updates this saved setlist order. It does not change song metadata or ratings.</p>
          </div>
          <button type="button" className="btn btn-primary px-3 py-1 text-xs" disabled={analysis.recommendedOrder.length === 0} onClick={onApplyOrder}>
            Apply AI Order
          </button>
        </div>
        {analysis.recommendedOrderWarning && (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {analysis.recommendedOrderWarning}
            {analysis.recommendedOrderProblems && analysis.recommendedOrderProblems.length > 0 && (
              <div className="mt-1 text-[var(--muted)]">{analysis.recommendedOrderProblems.slice(0, 6).join("; ")}</div>
            )}
          </div>
        )}
        {analysis.recommendedOrder.length > 0 ? (
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--border)] bg-black/10 px-3 py-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">AI Order Changes</h4>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {keptSameOrder
                  ? `AI kept the existing order. Reason: ${analysis.orderChangeSummary?.reason || analysis.orderStrategySummary || "AI did not identify a stronger sequence."}`
                  : `AI moved ${orderComparison.movedCount} of ${currentSongs.length} songs. ${orderComparison.unchangedCount} song${orderComparison.unchangedCount === 1 ? "" : "s"} stayed in the same slot.`}
              </p>
              {analysis.orderStrategySummary && !keptSameOrder && (
                <p className="mt-1 text-xs text-[var(--muted)]">{analysis.orderStrategySummary}</p>
              )}
              {!keptSameOrder && orderComparison.biggestMoves.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-[var(--text)]">Biggest moves</div>
                  <ul className="mt-1 space-y-1 text-xs text-[var(--muted)]">
                    {orderComparison.biggestMoves.map((move) => (
                      <li key={move.songId}>{move.title} moved from {move.from} to {move.to}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {Array.from(new Set(recommendedBySet.map((item) => item.setNumber))).map((setNumber) => (
              <div key={setNumber}>
                <h4 className="mb-2 text-sm font-medium text-[var(--accent)]">Set {setNumber}</h4>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--muted)]">
                  {recommendedBySet.filter((item) => item.setNumber === setNumber).map((item) => {
                    const song = byId.get(item.songId);
                    const reason = analysis.orderReasons?.[item.songId];
                    return (
                      <li key={`${item.setNumber}-${item.position}-${item.songId}`}>
                        <span className="font-medium text-[var(--text)]">{song?.title ?? item.songId}</span>
                        {song && <span> - {song.artist}</span>}
                        {song?.bpm != null && <span className="mono"> - {song.bpm} bpm</span>}
                        {reason && <span> - {reason}</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">No AI recommended order returned.</p>
        )}
      </div>
    </div>
  );
}

function formatAiAnalysisError(data: AiAnalysisResponse | null, fallback: string) {
  const provider = data?.provider === "anthropic" ? "Anthropic" : data?.provider === "openai" ? "OpenAI" : null;
  const parts: string[] = [];
  if (provider) parts.push(`Provider: ${provider}`);
  if (data?.model) parts.push(`Model: ${data.model}`);
  if (data?.status) parts.push(`Status: ${data.status}${data.statusText ? ` ${data.statusText}` : ""}`);
  if (data?.providerErrorMessage) parts.push(`${provider ?? "AI"} error: ${data.providerErrorMessage}`);
  if (data?.incompleteReason) parts.push(`Reason: ${data.incompleteReason}`);
  if (parts.length > 0) return parts.join(" · ");
  return typeof data?.error === "string" ? data.error : JSON.stringify(data?.error ?? fallback);
}

function AiAnalysisList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">{emptyText}</p>
      )}
    </div>
  );
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed (${response.status})`;

  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

export default function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [sets, setSets] = useState<Detail["sets"]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [recommendedSongs, setRecommendedSongs] = useState<Song[]>([]);
  const [replacementCursor, setReplacementCursor] = useState(0);
  const [replacementPrompt, setReplacementPrompt] = useState<ReplacementPrompt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [bpmExportBusy, setBpmExportBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiSetAnalysis | null>(null);
  const [ratingBusyKey, setRatingBusyKey] = useState<string | null>(null);
  const [bulkRatingBusy, setBulkRatingBusy] = useState(false);
  const [showCrowdResponse, setShowCrowdResponse] = useState(false);
  const [showAddSong, setShowAddSong] = useState(false);
  const [showSplitControls, setShowSplitControls] = useState(false);
  const [splitSetCount, setSplitSetCount] = useState(2);
  const [addSongId, setAddSongId] = useState("");
  const [addSongQuery, setAddSongQuery] = useState("");
  const [addSongResults, setAddSongResults] = useState<Song[]>([]);
  const [addSongSearchBusy, setAddSongSearchBusy] = useState(false);
  const [addSongSetIndex, setAddSongSetIndex] = useState(1);
  const [addSongPosition, setAddSongPosition] = useState("");
  const [addingSong, setAddingSong] = useState(false);
  const [draggedSong, setDraggedSong] = useState<DragLocation | null>(null);
  const [dragOverSong, setDragOverSong] = useState<DragLocation | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const songMap = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const addSongMap = useMemo(() => {
    const map = new Map(songs.map((song) => [song.id, song]));
    addSongResults.forEach((song) => map.set(song.id, song));
    return map;
  }, [addSongResults, songs]);
  const eventDuration = useMemo(() => totalDuration(sets.flatMap((set) => set.songs)), [sets]);
  const songCount = useMemo(() => sets.reduce((sum, set) => sum + set.songs.length, 0), [sets]);
  const currentSetSongs = useMemo(() => sets.flatMap((set) => set.songs), [sets]);
  const hasDurationData = useMemo(() => currentSetSongs.some((song) => (song.durationSec ?? 0) > 0), [currentSetSongs]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [detailResponse, songsResponse] = await Promise.all([
        fetch(`/api/setlists/${id}`, { cache: "no-store" }),
        fetch("/api/songs", { cache: "no-store" }),
      ]);
      const detailJson = await readObjectResponse<Detail>(detailResponse, router, "Setlist detail").catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Failed to load setlist.");
        return null;
      });
      const songsJson = await readArrayResponse<Song>(songsResponse, router, "Songs").catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Failed to load song library.");
        return [];
      });
      if (cancelled) return;
      if (!detailJson || !Array.isArray(detailJson.sets)) {
        setData(null);
        setSets([]);
        return;
      }
      setLoadError(null);
      const normalizedDetail = { ...detailJson, sets: normalizeLockedSets(detailJson.sets) };
      setData(normalizedDetail);
      setSets(normalizedDetail.sets);
      setSongs(songsJson);
      setRecommendedSongs([]);
      setReplacementCursor(0);
      setAiAnalysis(null);
      setShowCrowdResponse(false);
      setShowAddSong(false);
      setShowSplitControls(false);
      setSplitSetCount(Math.min(4, Math.max(1, detailJson.sets.length || 2)));
      setAddSongId("");
      setAddSongQuery("");
      setAddSongResults([]);
      setAddSongSetIndex(detailJson.sets[0]?.index ?? 1);
      setAddSongPosition("");
      setDirty(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    if (!data?.setlist.venueId) return;

    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams({ venueId: data.setlist.venueId ?? "", seed: String(Date.now()) });
      if (data.setlist.bandId) params.set("bandId", data.setlist.bandId);
      const response = await fetch(`/api/recommendations?${params.toString()}`, { cache: "no-store" });
      const json = await readObjectResponse<{ ranked?: unknown }>(response, router, "Recommendations").catch(() => null);
      if (!cancelled && Array.isArray(json?.ranked)) {
        setRecommendedSongs(json.ranked);
        setReplacementCursor(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.setlist.bandId, data?.setlist.venueId, router]);

  useEffect(() => {
    if (!showAddSong) return;
    const search = addSongQuery.trim();
    setAddSongId("");
    if (search.length < 2) {
      setAddSongResults([]);
      setAddSongSearchBusy(false);
      return;
    }

    let cancelled = false;
    setAddSongSearchBusy(true);
    const timeout = window.setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams({ q: search, limit: "50" });
        const response = await fetch(`/api/songs?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const json = await readArrayResponse<Song>(response, router, "Song search").catch((error) => {
          if (!cancelled) setMsg(error instanceof Error ? error.message : "Song search failed.");
          return [];
        });
        if (!cancelled) {
          setAddSongResults(json);
          setAddSongSearchBusy(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [addSongQuery, router, showAddSong]);

  function reshuffleAll() {
    if (sets.length === 0) return;
    const shuffledBlocks = shuffleSongs(sets.flatMap((set) => blockifySongs(set.songs)));
    const nextSets = Array.from({ length: sets.length }, (_, index) => ({ index: index + 1, songs: [] as Song[] }));
    shuffledBlocks.forEach((block, index) => {
      nextSets[index % nextSets.length].songs.push(...block);
    });
    setSets(normalizeLockedSets(nextSets));
    setDirty(true);
    setAiAnalysis(null);
    setMsg("Setlist reshuffled. Save the order when it feels right.");
  }

  function reshuffleSet(setIndex: number) {
    setSets((current) =>
      current.map((set) => (set.index === setIndex ? { ...set, songs: shuffleSongBlocks(set.songs) } : set)),
    );
    setDirty(true);
    setAiAnalysis(null);
    setMsg("Set reshuffled. Save the order when it feels right.");
  }

  function replaceSongAt(setIndex: number, songIndex: number, replacement: Song, message: string | null) {
    setSets((current) =>
      current.map((set) => {
        if (set.index !== setIndex) return set;
        const nextSongs = [...set.songs];
        if (!nextSongs[songIndex]) return set;
        nextSongs[songIndex] = replacement;
        return { ...set, songs: nextSongs };
      }),
    );
    setDirty(true);
    setAiAnalysis(null);
    setMsg(message);
  }

  function removeSongFromSetlist(setIndex: number, songIndex: number, song: Song) {
    if (!window.confirm("Remove this song from this saved setlist?")) return;
    setSets((current) =>
      current.map((set) => {
        if (set.index !== setIndex) return set;
        return { ...set, songs: normalizeLockedSongs(set.songs.filter((_, index) => index !== songIndex)) };
      }),
    );
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setMsg(`Removed ${song.title}. Save changes to persist.`);
  }

  function toggleLockWithNext(setIndex: number, songIndex: number) {
    setSets((current) =>
      normalizeLockedSets(current.map((set) => {
        if (set.index !== setIndex || songIndex >= set.songs.length - 1) return set;
        const nextSongs = set.songs.map((song, index) => (
          index === songIndex ? { ...song, lockedWithNext: !song.lockedWithNext } : song
        ));
        return { ...set, songs: nextSongs };
      })),
    );
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setMsg("Medley lock updated. Save changes to persist.");
  }

  function applySplitIntoSetCount(mode: "count" | "duration") {
    const nextSetCount = Math.max(1, Math.min(4, splitSetCount));
    const allSongs = sets.flatMap((set) => set.songs);
    const nextSets = mode === "duration"
      ? splitSongsEvenlyByDuration(allSongs, nextSetCount)
      : splitSongsEvenlyByCount(allSongs, nextSetCount);
    setSets(nextSets);
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setAddSongSetIndex(Math.min(nextSetCount, Math.max(1, addSongSetIndex)));
    setMsg(nextSetCount === 1 ? "Merged into one set. Save changes to persist." : `Split into ${nextSetCount} sets. Save changes to persist.`);
  }

  function addSetBreakAfter(setIndex: number, songIndex: number) {
    const sourceSet = sets.find((set) => set.index === setIndex);
    if (sourceSet?.songs[songIndex]?.lockedWithNext) {
      setMsg("Cannot add a set break inside a locked medley group.");
      return;
    }
    setSets((current) => {
      const setPosition = current.findIndex((set) => set.index === setIndex);
      const source = current[setPosition];
      if (!source || songIndex >= source.songs.length - 1) return current;
      const beforeBreak = source.songs.slice(0, songIndex + 1);
      const afterBreak = source.songs.slice(songIndex + 1);
      return normalizeLockedSets(renumberSets([
        ...current.slice(0, setPosition),
        { ...source, songs: beforeBreak },
        { index: source.index + 1, songs: afterBreak },
        ...current.slice(setPosition + 1),
      ]));
    });
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setMsg("Set break added. Save changes to persist.");
  }

  function removeSetBreakBefore(setIndex: number) {
    setSets((current) => {
      const setPosition = current.findIndex((set) => set.index === setIndex);
      if (setPosition <= 0) return current;
      const previous = current[setPosition - 1];
      const target = current[setPosition];
      return normalizeLockedSets(renumberSets([
        ...current.slice(0, setPosition - 1),
        { ...previous, songs: [...previous.songs, ...target.songs] },
        ...current.slice(setPosition + 1),
      ]));
    });
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setMsg("Set break removed. Save changes to persist.");
  }

  function addSongToSetlist() {
    if (addingSong) return;
    const song = addSongMap.get(addSongId);
    if (!song) {
      setMsg("Choose a song to add.");
      return;
    }
    const alreadyInSetlist = sets.some((set) => set.songs.some((item) => item.id === song.id));
    if (alreadyInSetlist && !window.confirm("This song is already in the setlist. Add it again?")) return;
    const currentTargetSet = sets.find((set) => set.index === addSongSetIndex) ?? sets[0];
    const requestedPosition = addSongPosition ? Number(addSongPosition) : (currentTargetSet?.songs.length ?? 0) + 1;
    const insertIndex = currentTargetSet && Number.isFinite(requestedPosition)
      ? Math.max(0, Math.min(currentTargetSet.songs.length, Math.round(requestedPosition) - 1))
      : currentTargetSet?.songs.length ?? 0;
    if (currentTargetSet && insertIndex > 0 && currentTargetSet.songs[insertIndex - 1]?.lockedWithNext) {
      setMsg("Cannot add a song inside a locked medley group.");
      return;
    }

    setAddingSong(true);
    setSets((current) => {
      const targetSet = current.find((set) => set.index === addSongSetIndex) ?? current[0];
      if (!targetSet) return current;
      const nextInsertIndex = Number.isFinite(requestedPosition)
        ? Math.max(0, Math.min(targetSet.songs.length, Math.round(requestedPosition) - 1))
        : targetSet.songs.length;
      return normalizeLockedSets(current.map((set) => {
        if (set.index !== targetSet.index) return set;
        const nextSongs = [...set.songs];
        nextSongs.splice(nextInsertIndex, 0, song);
        return { ...set, songs: nextSongs };
      }));
    });
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setAddSongId("");
    setAddSongPosition("");
    setAddingSong(false);
    setMsg(`Added ${song.title} to Set ${addSongSetIndex}. Save changes to persist.`);
  }

  function autoReplaceSong(setIndex: number, songIndex: number) {
    const pool = recommendedSongs.length > 0 ? recommendedSongs : shuffleSongs(songs);
    if (pool.length === 0) {
      setMsg("Add songs to the library before replacing songs.");
      return;
    }

    const currentSong = sets.find((set) => set.index === setIndex)?.songs[songIndex];
    const usedIds = new Set(sets.flatMap((set) => set.songs.map((song) => song.id)));
    if (currentSong) usedIds.delete(currentSong.id);

    let replacement: Song | null = null;
    let nextCursor = replacementCursor;
    for (let i = 0; i < pool.length; i++) {
      const candidateIndex = (replacementCursor + i) % pool.length;
      const candidate = songMap.get(pool[candidateIndex].id) ?? pool[candidateIndex];
      if (!usedIds.has(candidate.id)) {
        replacement = candidate;
        nextCursor = (candidateIndex + 1) % pool.length;
        break;
      }
    }

    if (!replacement) {
      setMsg("No unused replacement songs are available in the library.");
      return;
    }

    setReplacementCursor(nextCursor);
    replaceSongAt(setIndex, songIndex, replacement, `Replaced ${currentSong?.title ?? "song"} with ${replacement.title}. Save the setlist when it feels right.`);
  }

  function manuallyReplaceSong(setIndex: number, songIndex: number, songId: string) {
    if (!songId) return;
    const replacement = songMap.get(songId);
    if (!replacement) return;
    const currentSong = sets.find((set) => set.index === setIndex)?.songs[songIndex];
    replaceSongAt(setIndex, songIndex, replacement, `Replaced ${currentSong?.title ?? "song"} with ${replacement.title}. Save the setlist when it feels right.`);
  }

  function moveSong(setIndex: number, songIndex: number, direction: -1 | 1) {
    setSets((current) => {
      const next = current.map((set) => ({ ...set, songs: normalizeLockedSongs(set.songs) }));
      const sourceSetPosition = next.findIndex((set) => set.index === setIndex);
      const source = next[sourceSetPosition];
      if (!source) return current;
      const blocks = blockifySongs(source.songs);
      const blockIndex = findBlockIndexBySongIndex(blocks, songIndex);
      if (blockIndex < 0) return current;

      if (direction === -1 && blockIndex > 0) {
        [blocks[blockIndex - 1], blocks[blockIndex]] = [blocks[blockIndex], blocks[blockIndex - 1]];
        source.songs = songsFromBlocks(blocks);
        return next;
      }

      if (direction === 1 && blockIndex < blocks.length - 1) {
        [blocks[blockIndex], blocks[blockIndex + 1]] = [blocks[blockIndex + 1], blocks[blockIndex]];
        source.songs = songsFromBlocks(blocks);
        return next;
      }

      const targetSetPosition = sourceSetPosition + direction;
      const target = next[targetSetPosition];
      if (!target) return current;

      const [block] = blocks.splice(blockIndex, 1);
      if (!block) return current;
      source.songs = songsFromBlocks(blocks);
      const targetBlocks = blockifySongs(target.songs);
      if (direction === -1) targetBlocks.push(block);
      else targetBlocks.unshift(block);
      target.songs = songsFromBlocks(targetBlocks);
      return normalizeLockedSets(next);
    });

    setReplacementPrompt(null);
    setDirty(true);
    setAiAnalysis(null);
    setMsg("Song moved. Save the setlist when it feels right.");
  }

  function moveSongToSet(setIndex: number, songIndex: number, direction: -1 | 1) {
    const targetSetIndex = setIndex + direction;
    setSets((current) => {
      if (!current.some((set) => set.index === targetSetIndex)) return current;

      const next = current.map((set) => ({ ...set, songs: normalizeLockedSongs(set.songs) }));
      const source = next.find((set) => set.index === setIndex);
      const target = next.find((set) => set.index === targetSetIndex);
      if (!source || !target) return current;

      const sourceBlocks = blockifySongs(source.songs);
      const blockIndex = findBlockIndexBySongIndex(sourceBlocks, songIndex);
      if (blockIndex < 0) return current;
      const [block] = sourceBlocks.splice(blockIndex, 1);
      if (!block) return current;
      source.songs = songsFromBlocks(sourceBlocks);
      const targetBlocks = blockifySongs(target.songs);
      targetBlocks.push(block);
      target.songs = songsFromBlocks(targetBlocks);
      return normalizeLockedSets(next);
    });
    setDirty(true);
    setAiAnalysis(null);
    setMsg(null);
  }

  function moveDraggedSong(source: DragLocation, target: DragLocation | { setIndex: number; songIndex: "end" }) {
    setSets((current) => {
      const next = current.map((set) => ({ ...set, songs: normalizeLockedSongs(set.songs) }));
      const sourceSet = next.find((set) => set.index === source.setIndex);
      const targetSet = next.find((set) => set.index === target.setIndex);
      if (!sourceSet || !targetSet) return current;
      const sourceBlocks = blockifySongs(sourceSet.songs);
      const sourceBlockIndex = findBlockIndexBySongIndex(sourceBlocks, source.songIndex);
      if (sourceBlockIndex < 0) return current;
      const [block] = sourceBlocks.splice(sourceBlockIndex, 1);
      if (!block) return current;
      sourceSet.songs = songsFromBlocks(sourceBlocks);

      const targetBlocks = blockifySongs(targetSet.songs);
      let insertBlockIndex = blockInsertIndexForSongIndex(targetBlocks, target.songIndex);
      if (target.songIndex !== "end" && source.setIndex === target.setIndex && sourceBlockIndex < insertBlockIndex) insertBlockIndex -= 1;
      targetBlocks.splice(Math.max(0, insertBlockIndex), 0, block);
      targetSet.songs = songsFromBlocks(targetBlocks);
      return normalizeLockedSets(next);
    });
    setDirty(true);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setMsg("Song moved by drag. Save the setlist when it feels right.");
  }

  function handleDrop(target: DragLocation | { setIndex: number; songIndex: "end" }) {
    if (!draggedSong) return;
    if (target.songIndex !== "end" && draggedSong.setIndex === target.setIndex && draggedSong.songIndex === target.songIndex) {
      setDraggedSong(null);
      setDragOverSong(null);
      return;
    }
    moveDraggedSong(draggedSong, target);
    setDraggedSong(null);
    setDragOverSong(null);
  }

  async function saveOrder() {
    setReplacementPrompt(null);
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/setlists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sets: setPayload(sets) }),
    });
    const json = await r.json().catch(() => null);
    setBusy(false);

    if (!r.ok) {
      setMsg(json?.error ? JSON.stringify(json.error) : await readErrorMessage(r));
      return;
    }

    if (json?.sets) {
      const normalizedDetail = { ...json, sets: normalizeLockedSets(json.sets) } as Detail;
      setData(normalizedDetail);
      setSets(normalizedDetail.sets);
    }
    setDirty(false);
    setReplacementPrompt(null);
    setMsg("Saved setlist changes.");
  }

  async function analyzeSetWithAi(provider: AiProvider) {
    if (!data?.setlist || songCount === 0) {
      setMsg("Load a setlist before asking AI to analyze it.");
      return;
    }
    setAiBusy(true);
    setMsg(`Analyzing set with ${provider === "anthropic" ? "Anthropic" : "OpenAI"}...`);
    try {
      const response = await fetch("/api/ai/analyze-set", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          setlistId: id,
          bandId: data.setlist.bandId || undefined,
          venueId: data.setlist.venueId || undefined,
          bandName: data.setlist.bandName ?? undefined,
          venueName: data.setlist.venueName ?? undefined,
          venueType: data.setlist.venueType ?? undefined,
          crowdSetup: data.setlist.crowdSetup ?? undefined,
          performedAt: data.setlist.performedAt ?? undefined,
          startTime: data.setlist.startTime ?? undefined,
          endTime: data.setlist.endTime ?? undefined,
          numSets: sets.length,
          lockedGroups: lockedGroupsForSets(sets),
          sets: sets.map((set) => ({ index: set.index, songs: set.songs.map((song, index) => compactSongForAi(song, set.index, index + 1)) })),
        }),
      });
      const text = await response.text();
      const json = text ? JSON.parse(text) as AiAnalysisResponse : null;
      if (!response.ok || !json?.ok || !json.analysis) {
        setMsg(formatAiAnalysisError(json, `AI analysis failed (${response.status}).`));
        return;
      }
      setAiAnalysis({ ...json.analysis, provider: json.provider, model: json.model });
      setMsg(`${json.provider === "anthropic" ? "Anthropic" : "OpenAI"} AI Set Analysis is ready.`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "AI analysis failed.");
    } finally {
      setAiBusy(false);
    }
  }

  function compactSongForAi(song: Song, setNumber: number, position: number) {
    return {
      songId: song.id,
      setNumber,
      position,
      title: song.title,
      artist: song.artist,
      bpm: song.bpm ?? null,
      duration: song.durationSec ?? null,
      key: song.musicalKey ?? null,
      genre: song.genre ?? null,
      energy: song.energy ?? null,
      singalongScore: song.singalongScore ?? null,
      danceability: song.danceability ?? null,
      crowdFamiliarity: song.crowdScore ?? null,
      femaleParticipationScore: song.femaleParticipationScore ?? null,
      peakHourScore: song.peakHourScore ?? null,
      transitionFlexibility: song.transitionFlexibility ?? null,
      vocalDifficulty: song.vocalDifficulty ?? null,
      openerCandidate: song.openerCandidate ?? null,
      closerCandidate: song.closerCandidate ?? null,
      crowdResponseScore: song.performanceRating?.crowdResponseScore ?? null,
    };
  }

  function validateAiRecommendedOrder() {
    if (!aiAnalysis) return { ok: false, problems: ["No AI recommended order is available."], orderedSets: [] as ReturnType<typeof setPayload> };
    const sourceSongs = currentSetSongs;
    const byId = new Map(sourceSongs.map((song) => [song.id, song]));
    const usedIds = new Set<string>();
    const problems: string[] = [];
    const orderedSets: Song[][] = Array.from({ length: sets.length }, () => []);
    const ordered = [...aiAnalysis.recommendedOrder].sort((a, b) => a.setNumber - b.setNumber || a.position - b.position);

    for (const item of ordered) {
      const song = byId.get(item.songId);
      if (!song) {
        problems.push(`Unknown songId: ${item.songId}`);
        continue;
      }
      if (usedIds.has(song.id)) {
        problems.push(`Duplicate song: ${song.title} - ${song.artist}`);
        continue;
      }
      if (item.setNumber < 1 || item.setNumber > sets.length) {
        problems.push(`Invalid set number for ${song.title}: Set ${item.setNumber}`);
        continue;
      }
      usedIds.add(song.id);
      orderedSets[item.setNumber - 1].push(song);
    }

    for (const song of sourceSongs) {
      if (!usedIds.has(song.id)) problems.push(`Missing song: ${song.title} - ${song.artist}`);
    }
    if (usedIds.size !== sourceSongs.length) problems.push(`Expected ${sourceSongs.length} songs, but AI returned ${usedIds.size} unique matching song${usedIds.size === 1 ? "" : "s"}.`);

    if (problems.length > 0) return { ok: false, problems, orderedSets: [] as ReturnType<typeof setPayload> };

    const repairedSets = normalizeLockedSets(orderedSets.map((songs, index) => ({ index: index + 1, songs: songs.map((song) => ({ ...song, lockedWithNext: false })) })));
    const repairWarnings: string[] = [];
    for (const group of lockedGroupsForSets(sets)) {
      const groupIds = group.songIds;
      let firstSetIndex = -1;
      let firstSongIndex = Number.POSITIVE_INFINITY;
      repairedSets.forEach((set, setIndex) => {
        set.songs.forEach((song, songIndex) => {
          if (groupIds.includes(song.id) && (firstSetIndex === -1 || setIndex < firstSetIndex || (setIndex === firstSetIndex && songIndex < firstSongIndex))) {
            firstSetIndex = setIndex;
            firstSongIndex = songIndex;
          }
        });
      });
      if (firstSetIndex === -1) continue;
      const groupSongs = groupIds.map((songId) => sourceSongs.find((song) => song.id === songId)).filter((song): song is Song => Boolean(song));
      repairedSets.forEach((set) => {
        set.songs = set.songs.filter((song) => !groupIds.includes(song.id));
      });
      const targetSongs = repairedSets[firstSetIndex].songs;
      const insertIndex = Math.min(firstSongIndex, targetSongs.length);
      targetSongs.splice(insertIndex, 0, ...groupSongs.map((song, index) => ({ ...song, lockedWithNext: index < groupSongs.length - 1 })));
      repairWarnings.push(`Kept medley locked: ${group.title}`);
    }
    const normalized = normalizeLockedSets(repairedSets);
    return { ok: true, problems: repairWarnings, orderedSets: setPayload(normalized) };
  }

  async function applyAiRecommendedOrder() {
    if (!window.confirm("Apply AI recommended order to this saved setlist?")) return;
    const validation = validateAiRecommendedOrder();
    if (!validation.ok) {
      setMsg(`Could not apply AI order: ${validation.problems.slice(0, 8).join("; ")}`);
      return;
    }
    setBusy(true);
    setMsg(null);
    const response = await fetch(`/api/setlists/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sets: validation.orderedSets }),
    });
    const json = await response.json().catch(() => null) as Partial<Detail> & { error?: unknown } | null;
    setBusy(false);
    if (!response.ok || !json || json.error || !json.setlist || !Array.isArray(json.sets)) {
      setMsg(json?.error ? JSON.stringify(json.error) : `Apply AI order failed (${response.status}).`);
      return;
    }
    const detail = json as Detail;
    const normalizedDetail = { ...detail, sets: normalizeLockedSets(detail.sets) };
    setData(normalizedDetail);
    setSets(normalizedDetail.sets);
    setDirty(false);
    setReplacementPrompt(null);
    setAiAnalysis(null);
    setMsg(validation.problems.length > 0 ? `AI recommended order applied. ${validation.problems.slice(0, 3).join("; ")}` : "AI recommended order applied.");
  }

  async function saveRating(setIndex: number, songIndex: number, song: Song, score: number | null, notes: string | null) {
    const key = `${setIndex}-${song.id}-${songIndex}`;
    setRatingBusyKey(key);
    setMsg(null);
    const response = await fetch(`/api/setlists/${id}/ratings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId: song.id, crowdResponseScore: score, notes }),
    });
    const json = await response.json().catch(() => null) as { crowdResponseScore?: number | null; notes?: string | null; updatedAt?: string | null; error?: unknown } | null;
    setRatingBusyKey(null);
    if (!response.ok || !json) {
      setMsg(json?.error ? JSON.stringify(json.error) : await readErrorMessage(response));
      return;
    }
    setSets((current) =>
      current.map((set) => set.index === setIndex ? {
        ...set,
        songs: set.songs.map((item, index) => index === songIndex ? {
          ...item,
          performanceRating: {
            crowdResponseScore: json.crowdResponseScore ?? null,
            notes: json.notes ?? null,
            updatedAt: json.updatedAt ?? null,
          },
        } : item),
      } : set),
    );
    setMsg(`Saved crowd response for ${song.title}.`);
  }

  async function rateEntireSet(score: number | null) {
    if (songCount === 0) return;
    if (!window.confirm("Apply this crowd response rating to every song in this setlist?")) return;

    setBulkRatingBusy(true);
    setMsg(null);
    const uniqueSongs = Array.from(new Map(currentSetSongs.map((song) => [song.id, song])).values());
    try {
      const results = await Promise.all(uniqueSongs.map(async (song) => {
        const response = await fetch(`/api/setlists/${id}/ratings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ songId: song.id, crowdResponseScore: score, notes: song.performanceRating?.notes ?? null }),
        });
        const json = await response.json().catch(() => null) as { crowdResponseScore?: number | null; notes?: string | null; updatedAt?: string | null; error?: unknown } | null;
        if (!response.ok || !json) {
          const error = json?.error ? JSON.stringify(json.error) : `Rating failed for ${song.title} (${response.status}).`;
          throw new Error(error);
        }
        return { songId: song.id, crowdResponseScore: json.crowdResponseScore ?? null, notes: json.notes ?? null, updatedAt: json.updatedAt ?? null };
      }));
      const bySongId = new Map(results.map((result) => [result.songId, result]));
      setSets((current) =>
        current.map((set) => ({
          ...set,
          songs: set.songs.map((song) => {
            const rating = bySongId.get(song.id);
            return rating ? {
              ...song,
              performanceRating: {
                crowdResponseScore: rating.crowdResponseScore,
                notes: rating.notes,
                updatedAt: rating.updatedAt,
              },
            } : song;
          }),
        })),
      );
      setMsg("Applied crowd response rating to the full setlist.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not rate the full setlist.");
    } finally {
      setBulkRatingBusy(false);
    }
  }

  async function exportOnSong() {
    setExportBusy(true);
    setMsg(null);
    const response = await fetch(`/api/setlists/${id}/onsong-export`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sets: sets.map((set) => set.songs.map((song) => song.id)) }),
    });
    setExportBusy(false);

    if (!response.ok) {
      setMsg("OnSong export failed.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFromDisposition(response.headers.get("Content-Disposition")) ?? "Band Setlist - OnSong.archive";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMsg("OnSong export downloaded.");
  }

  async function exportBpmPrompter() {
    setBpmExportBusy(true);
    setMsg(null);
    const response = await fetch(`/api/setlists/${id}/bpm-prompter-export`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sets: sets.map((set) => set.songs.map((song) => song.id)) }),
    });
    setBpmExportBusy(false);

    if (!response.ok) {
      setMsg("BPM Prompter export failed.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFromDisposition(response.headers.get("Content-Disposition")) ?? "Band Setlist - BPM Prompter.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMsg("BPM Prompter export downloaded.");
  }

  function resetOrder() {
    if (!data) return;
    setSets(normalizeLockedSets(data.sets));
    setDirty(false);
    setAiAnalysis(null);
    setReplacementPrompt(null);
    setMsg("Restored the last saved order.");
  }

  if (loadError) {
    return (
      <div className="text-sm text-rose-300">
        {loadError}{" "}
        <Link href="/history" className="text-[var(--accent)] underline">
          Back
        </Link>
      </div>
    );
  }

  if (!data?.setlist) {
    return (
      <div className="text-sm text-[var(--muted)]">
        Loading...{" "}
        <Link href="/history" className="text-[var(--accent)] underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/history" className="no-print text-sm text-[var(--accent)] hover:underline">
        Back to history
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{data.setlist.title || "Setlist"}</h1>
          <p className="text-sm text-[var(--muted)]">
            {data.setlist.performedAt
              ? `Performance date: ${formatDate(data.setlist.performedAt)}`
              : `Created: ${new Date(data.setlist.createdAt).toLocaleString()}`}
          </p>
          <div className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2">
            <div>Venue Type: <span className="text-[var(--text)]">{data.setlist.venueType ?? "Not set"}</span></div>
            <div>Crowd Setup: <span className="text-[var(--text)]">{data.setlist.crowdSetup ?? "Mixed"}</span></div>
            <div>Start Time: <span className="text-[var(--text)]">{formatTime(data.setlist.startTime)}</span></div>
            <div>End Time: <span className="text-[var(--text)]">{formatTime(data.setlist.endTime)}</span></div>
            {gigWindow(data.setlist.startTime, data.setlist.endTime) && (
              <div className="sm:col-span-2">Gig Duration Window: <span className="text-[var(--text)]">{gigWindow(data.setlist.startTime, data.setlist.endTime)}</span></div>
            )}
          </div>
          <div className="print-only mt-2 text-sm">
            <div>Band: {data.setlist.bandName ?? "No band assigned"}</div>
            <div>Venue: {data.setlist.venueName ?? "Unknown venue"}</div>
            <div>Venue type: {data.setlist.venueType ?? "Not set"}</div>
            <div>Crowd setup: {data.setlist.crowdSetup ?? "Mixed"}</div>
            <div>Performance date: {formatDate(data.setlist.performedAt)}</div>
            <div>Start Time: {formatTime(data.setlist.startTime)}</div>
            <div>End Time: {formatTime(data.setlist.endTime)}</div>
            <div>{sets.length} set{sets.length === 1 ? "" : "s"} - {songCount} song{songCount === 1 ? "" : "s"}</div>
          </div>
          <p className="mono mt-1 text-xs text-[var(--muted)]">Total duration: {formatDuration(eventDuration)}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton className="px-3 py-1 text-xs" />
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={exportBusy || songCount === 0} onClick={() => void exportOnSong()}>
            {exportBusy ? "Exporting" : "OnSong Export"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={bpmExportBusy || songCount === 0} onClick={() => void exportBpmPrompter()}>
            {bpmExportBusy ? "Exporting" : "BPM Prompter Export"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={aiBusy || busy || songCount === 0} onClick={() => void analyzeSetWithAi("openai")}>
            {aiBusy ? "Analyzing" : "AI Analyze Set (OpenAI)"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={aiBusy || busy || songCount === 0} onClick={() => void analyzeSetWithAi("anthropic")}>
            {aiBusy ? "Analyzing" : "AI Analyze Set (Anthropic)"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setShowAddSong((value) => !value)}>
            {showAddSong ? "Hide Add Song" : "Add Song"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setShowSplitControls((value) => !value)}>
            {showSplitControls ? "Hide Split Controls" : "Split Into Sets"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setShowCrowdResponse((value) => !value)}>
            {showCrowdResponse ? "Hide Crowd Response" : "Edit Crowd Response"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={reshuffleAll}>
            Reshuffle all
          </button>
          <button type="button" className="btn btn-primary px-3 py-1 text-xs" disabled={busy || !dirty} onClick={() => void saveOrder()}>
            {busy ? "Saving" : "Save changes"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={!dirty || busy} onClick={resetOrder}>
            Reset
          </button>
        </div>
      </div>

      {msg && <div className="no-print rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">{msg}</div>}

      {aiAnalysis && <AiSetAnalysisPanel analysis={aiAnalysis} currentSongs={currentSetSongs} currentSets={sets} onApplyOrder={() => void applyAiRecommendedOrder()} />}

      {showSplitControls && (
        <div className="no-print rounded-lg border border-[var(--border)] bg-[#0f131a]/50 px-3 py-3 text-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium text-[var(--accent)]">Split Into Sets</h2>
              <p className="mt-1 text-[var(--muted)]">
                Preserve the current song order while reshaping this saved setlist. Save changes to persist.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-[var(--muted)]">
              Number of sets
              <select className="input mt-1 min-w-28" value={splitSetCount} onChange={(event) => setSplitSetCount(Number(event.target.value))}>
                {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary h-10 px-3 text-xs" disabled={songCount === 0} onClick={() => applySplitIntoSetCount("count")}>
              Split evenly by song count
            </button>
            <button
              type="button"
              className="btn btn-ghost h-10 px-3 text-xs"
              disabled={songCount === 0 || !hasDurationData}
              onClick={() => applySplitIntoSetCount("duration")}
              title={hasDurationData ? "Split by available duration data" : "No song duration data is available"}
            >
              Split evenly by duration
            </button>
            <span className="text-[var(--muted)]">Manual option: use Add Set Break After This Song on any row.</span>
          </div>
        </div>
      )}

      {showAddSong && (
        <div className="no-print rounded-lg border border-[var(--border)] bg-[#0f131a]/50 px-3 py-3 text-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium text-[var(--accent)]">Add Song</h2>
              <p className="mt-1 text-[var(--muted)]">Add from the existing song library, then Save changes to persist.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
            <label className="block text-[var(--muted)]">
              Search / Song
              <input
                className="input mt-1"
                placeholder="Type at least 2 letters of title or artist"
                value={addSongQuery}
                onChange={(event) => setAddSongQuery(event.target.value)}
              />
              <select className="input mt-2" value={addSongId} onChange={(event) => setAddSongId(event.target.value)}>
                <option value="">
                  {addSongQuery.trim().length < 2
                    ? "Search to choose a song..."
                    : addSongSearchBusy
                      ? "Searching..."
                      : addSongResults.length === 0
                        ? "No matches found"
                        : "Choose song..."}
                </option>
                {addSongResults.map((song) => (
                  <option key={song.id} value={song.id}>{song.title} - {song.artist}</option>
                ))}
              </select>
              <span className="mt-1 block text-[var(--muted)]">
                {addSongQuery.trim().length < 2
                  ? "Search the full song library by title or artist."
                  : addSongSearchBusy
                    ? "Searching the full library..."
                    : `Showing ${addSongResults.length} matching song${addSongResults.length === 1 ? "" : "s"}.`}
              </span>
            </label>
            <label className="block text-[var(--muted)]">
              Set
              <select className="input mt-1 min-w-28" value={addSongSetIndex} onChange={(event) => {
                setAddSongSetIndex(Number(event.target.value));
                setAddSongPosition("");
              }}>
                {sets.map((set) => <option key={set.index} value={set.index}>Set {set.index}</option>)}
              </select>
            </label>
            <label className="block text-[var(--muted)]">
              Position
              <input
                className="input mt-1 w-28"
                inputMode="numeric"
                placeholder="End"
                value={addSongPosition}
                onChange={(event) => setAddSongPosition(event.target.value)}
              />
            </label>
            <div className="flex items-end">
              <button type="button" className="btn btn-primary h-10 px-3 text-xs" disabled={addingSong || !addSongId} onClick={addSongToSetlist}>
                {addingSong ? "Adding..." : "Add Song"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCrowdResponse && <div className="no-print rounded-lg border border-[var(--border)] bg-[#0f131a]/50 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--text)]">Rate Entire Set</span>
          {crowdRatingOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              className="btn btn-ghost h-8 px-2 py-0 text-xs"
              disabled={bulkRatingBusy || songCount === 0}
              onClick={() => void rateEntireSet(option.value)}
            >
              {option.label}
            </button>
          ))}
          {bulkRatingBusy && <span className="text-[var(--muted)]">Saving...</span>}
        </div>
      </div>}

      {sets.map((s) => {
        const setDuration = totalDuration(s.songs);
        return (
        <div key={s.index} className="card print-section">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-[var(--accent)]">Set {s.index} <span className="mono text-xs text-[var(--muted)]">- {formatDuration(setDuration)}</span></h2>
            <div className="no-print flex flex-wrap gap-2">
              {s.index > 1 && (
                <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => removeSetBreakBefore(s.index)}>
                  Remove Set Break
                </button>
              )}
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => reshuffleSet(s.index)}>
                Reshuffle set
              </button>
            </div>
          </div>
          <ol
            className={`no-print space-y-1 rounded-lg text-sm ${draggedSong ? "border border-dashed border-[var(--border)] p-1" : ""}`}
            onDragOver={(event) => {
              if (!draggedSong) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (!draggedSong) return;
              event.preventDefault();
              handleDrop({ setIndex: s.index, songIndex: "end" });
            }}
          >
            {s.songs.map((song, songIndex) => {
              const usedIds = new Set(sets.flatMap((set) => set.songs.map((item) => item.id)));
              const promptIsOpen = replacementPrompt?.setIndex === s.index && replacementPrompt.songIndex === songIndex;
              const promptIsList = promptIsOpen && replacementPrompt.mode === "list";
              const isDragging = draggedSong?.setIndex === s.index && draggedSong.songIndex === songIndex;
              const isDropTarget = dragOverSong?.setIndex === s.index && dragOverSong.songIndex === songIndex;
              const groupBounds = medleyGroupBounds(s.songs, songIndex);
              const isInMedley = groupBounds.size > 1;
              const isMedleyStart = isInMedley && groupBounds.start === songIndex;
              const isMedleyContinuation = isInMedley && groupBounds.start < songIndex;
              return (
                <li
                  key={`${s.index}-${song.id}-${songIndex}`}
                  className={`grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-[#0f131a] ${isInMedley ? "border-l-2 border-[var(--accent)] bg-[#0f131a]/40" : ""} ${isDragging ? "opacity-50 ring-1 ring-[var(--accent)]" : ""} ${isDropTarget ? "border-t-2 border-[var(--accent)] bg-[#0f131a]" : ""}`}
                  onDragOver={(event) => {
                    if (!draggedSong) return;
                    event.preventDefault();
                    setDragOverSong({ setIndex: s.index, songIndex });
                  }}
                  onDragLeave={() => {
                    setDragOverSong((current) => current?.setIndex === s.index && current.songIndex === songIndex ? null : current);
                  }}
                  onDrop={(event) => {
                    if (!draggedSong) return;
                    event.preventDefault();
                    event.stopPropagation();
                    handleDrop({ setIndex: s.index, songIndex });
                  }}
                >
                  <button
                    type="button"
                    className={`btn h-7 px-2 py-0 text-xs ${song.lockedWithNext ? "btn-primary" : "btn-ghost"}`}
                    disabled={songIndex >= s.songs.length - 1}
                    onClick={() => toggleLockWithNext(s.index, songIndex)}
                    title={song.lockedWithNext ? "Unlock this song from the next song" : "Lock this song to the next song"}
                  >
                    Link
                  </button>
                  <span className="mono text-xs text-[var(--muted)]">{songIndex + 1}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    draggable
                    className="cursor-grab select-none rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] active:cursor-grabbing"
                    title="Drag to reorder"
                    aria-label={`Drag ${song.title} to reorder`}
                    onDragStart={(event) => {
                      setDraggedSong({ setIndex: s.index, songIndex });
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", `${s.index}:${songIndex}`);
                    }}
                    onDragEnd={() => {
                      setDraggedSong(null);
                      setDragOverSong(null);
                    }}
                  >
                    ::
                  </span>
                  <span>
                    {song.title} <span className="text-[var(--muted)]">- {song.artist}</span>
                    {song.bpm != null && <span className="mono text-xs text-[var(--muted)]"> ({song.bpm} bpm)</span>}
                    {isMedleyStart && <span className="ml-2 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent)]">Medley group</span>}
                    {isMedleyContinuation && <span className="ml-2 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">Medley locked</span>}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    <button
                      type="button"
                      className="btn btn-ghost h-7 px-2 py-0 text-xs"
                      onClick={() => setReplacementPrompt(promptIsOpen ? null : { setIndex: s.index, songIndex, mode: "choices" })}
                      title="Replace song"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-7 w-7 px-0 py-0 text-xs"
                      disabled={s.index === 1 && songIndex === 0}
                      onClick={() => moveSong(s.index, songIndex, -1)}
                      title="Move up"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-7 w-9 px-0 py-0 text-xs"
                      disabled={s.index === sets.length && songIndex === s.songs.length - 1}
                      onClick={() => moveSong(s.index, songIndex, 1)}
                      title="Move down"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-7 w-10 px-0 py-0 text-xs"
                      disabled={s.index === 1}
                      onClick={() => moveSongToSet(s.index, songIndex, -1)}
                      title="Move to previous set"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-7 w-10 px-0 py-0 text-xs"
                      disabled={s.index === sets.length}
                      onClick={() => moveSongToSet(s.index, songIndex, 1)}
                      title="Move to next set"
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-7 px-2 py-0 text-xs text-rose-200 hover:text-rose-100"
                      onClick={() => removeSongFromSetlist(s.index, songIndex, song)}
                      title="Remove from this setlist"
                    >
                      Remove
                    </button>
                    {songIndex < s.songs.length - 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost h-7 px-2 py-0 text-xs"
                        disabled={Boolean(song.lockedWithNext)}
                        onClick={() => addSetBreakAfter(s.index, songIndex)}
                        title={song.lockedWithNext ? "Unlock this medley link before adding a set break here" : "Create a new set starting with the next song"}
                      >
                        Add Set Break After
                      </button>
                    )}
                  </span>
                  {promptIsOpen && (
                    <div className="col-start-4 col-span-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-2">
                      <button
                        type="button"
                        className="btn btn-primary h-8 px-3 py-0 text-xs"
                        onClick={() => autoReplaceSong(s.index, songIndex)}
                      >
                        Auto replace
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost h-8 px-3 py-0 text-xs"
                        onClick={() => setReplacementPrompt({ setIndex: s.index, songIndex, mode: "list" })}
                      >
                        Select from list
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost h-8 px-3 py-0 text-xs"
                        onClick={() => setReplacementPrompt(null)}
                      >
                        Cancel
                      </button>
                      {promptIsList && (
                        <select
                          className="input h-8 min-w-64 px-2 py-0 text-xs"
                          value=""
                          onChange={(event) => manuallyReplaceSong(s.index, songIndex, event.target.value)}
                          title="Choose replacement song"
                        >
                          <option value="">Choose replacement song...</option>
                          {songs.map((option) => (
                            <option key={option.id} value={option.id} disabled={option.id !== song.id && usedIds.has(option.id)}>
                              {option.title} - {option.artist}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {showCrowdResponse && (
                    <SongPerformanceRating
                      song={song}
                      busy={ratingBusyKey === `${s.index}-${song.id}-${songIndex}`}
                      onSave={(score) => void saveRating(s.index, songIndex, song, score, song.performanceRating?.notes ?? null)}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <table className="print-only w-full table-fixed border-collapse text-sm leading-tight">
            <colgroup>
              <col className="w-[8%]" />
              <col className="w-[46%]" />
              <col className="w-[34%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">Song</th>
                <th className="py-1 pr-2 font-medium">Artist</th>
                <th className="py-1 pr-2 text-right font-medium">BPM</th>
              </tr>
            </thead>
            <tbody>
              {s.songs.map((song, songIndex) => (
                <tr key={`print-${s.index}-${song.id}-${songIndex}`} className="border-b border-[var(--border)]">
                  <td className="py-1 pr-2 align-top">{songIndex + 1}</td>
                  <td className="break-words py-1 pr-2 align-top font-medium">{song.title}</td>
                  <td className="break-words py-1 pr-2 align-top">{song.artist}</td>
                  <td className="py-1 pr-2 text-right align-top font-medium">{song.bpm ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })}
    </div>
  );
}
