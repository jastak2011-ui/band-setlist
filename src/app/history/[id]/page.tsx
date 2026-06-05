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
    bandId?: string | null;
    bandName?: string | null;
  };
  sets: { index: number; songs: Song[] }[];
};
type AiRecommendedOrderItem = { songId?: string; setNumber: number; position: number; title: string; artist: string; reason: string };
type AiSetAnalysis = {
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
  recommendedOrder: AiRecommendedOrderItem[];
  recommendedOrderWarning?: string | null;
  recommendedOrderProblems?: string[];
};
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

function filenameFromDisposition(disposition: string | null) {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function SongPerformanceRating({ song, busy, onSave }: { song: Song; busy: boolean; onSave: (score: number | null) => void }) {
  const currentScore = song.performanceRating?.crowdResponseScore ?? null;

  return (
    <div className="col-start-3 col-span-2 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2 text-xs">
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

function AiSetAnalysisPanel({ analysis, currentSongs, onApplyOrder }: { analysis: AiSetAnalysis; currentSongs: Song[]; onApplyOrder: () => void }) {
  const byId = new Map(currentSongs.map((song) => [song.id, song]));
  const byIdentity = new Map(currentSongs.map((song) => [normalizeSongKey(song.title, song.artist), song]));
  const recommendedBySet = [...analysis.recommendedOrder].sort((a, b) => a.setNumber - b.setNumber || a.position - b.position);

  return (
    <div className="no-print rounded-lg border border-[var(--border)] bg-[#0f131a]/50 px-3 py-3 text-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-[var(--accent)]">AI Set Analysis</h2>
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
            {Array.from(new Set(recommendedBySet.map((item) => item.setNumber))).map((setNumber) => (
              <div key={setNumber}>
                <h4 className="mb-2 text-sm font-medium text-[var(--accent)]">Set {setNumber}</h4>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--muted)]">
                  {recommendedBySet.filter((item) => item.setNumber === setNumber).map((item) => {
                    const song = item.songId ? byId.get(item.songId) : byIdentity.get(normalizeSongKey(item.title, item.artist));
                    return (
                      <li key={`${item.setNumber}-${item.position}-${item.songId ?? item.title}-${item.artist}`}>
                        <span className="font-medium text-[var(--text)]">{item.title}</span>
                        <span> - {item.artist}</span>
                        {song?.bpm != null && <span className="mono"> - {song.bpm} bpm</span>}
                        <span> - {item.reason}</span>
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
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiSetAnalysis | null>(null);
  const [ratingBusyKey, setRatingBusyKey] = useState<string | null>(null);
  const [bulkRatingBusy, setBulkRatingBusy] = useState(false);
  const [showCrowdResponse, setShowCrowdResponse] = useState(false);
  const [showAddSong, setShowAddSong] = useState(false);
  const [addSongId, setAddSongId] = useState("");
  const [addSongQuery, setAddSongQuery] = useState("");
  const [addSongSetIndex, setAddSongSetIndex] = useState(1);
  const [addSongPosition, setAddSongPosition] = useState("");
  const [addingSong, setAddingSong] = useState(false);
  const [draggedSong, setDraggedSong] = useState<DragLocation | null>(null);
  const [dragOverSong, setDragOverSong] = useState<DragLocation | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const songMap = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const eventDuration = useMemo(() => totalDuration(sets.flatMap((set) => set.songs)), [sets]);
  const songCount = useMemo(() => sets.reduce((sum, set) => sum + set.songs.length, 0), [sets]);
  const currentSetSongs = useMemo(() => sets.flatMap((set) => set.songs), [sets]);
  const filteredAddSongs = useMemo(() => {
    const query = normalizeNameForMatch(addSongQuery);
    return songs
      .filter((song) => {
        if (!query) return true;
        return normalizeNameForMatch(`${song.title} ${song.artist}`).includes(query);
      })
      .slice(0, 80);
  }, [addSongQuery, songs]);

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
      setData(detailJson);
      setSets(detailJson.sets);
      setSongs(songsJson);
      setRecommendedSongs([]);
      setReplacementCursor(0);
      setAiAnalysis(null);
      setShowCrowdResponse(false);
      setShowAddSong(false);
      setAddSongId("");
      setAddSongQuery("");
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

  function reshuffleAll() {
    if (sets.length === 0) return;
    setSets(redistributeSongs(shuffleSongs(sets.flatMap((set) => set.songs)), sets.length));
    setDirty(true);
    setAiAnalysis(null);
    setMsg("Setlist reshuffled. Save the order when it feels right.");
  }

  function reshuffleSet(setIndex: number) {
    setSets((current) =>
      current.map((set) => (set.index === setIndex ? { ...set, songs: shuffleSongs(set.songs) } : set)),
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

  function addSongToSetlist() {
    if (addingSong) return;
    const song = songMap.get(addSongId);
    if (!song) {
      setMsg("Choose a song to add.");
      return;
    }
    const alreadyInSetlist = sets.some((set) => set.songs.some((item) => item.id === song.id));
    if (alreadyInSetlist && !window.confirm("This song is already in the setlist. Add it again?")) return;

    setAddingSong(true);
    setSets((current) => {
      const targetSet = current.find((set) => set.index === addSongSetIndex) ?? current[0];
      if (!targetSet) return current;
      const requestedPosition = addSongPosition ? Number(addSongPosition) : targetSet.songs.length + 1;
      const insertIndex = Number.isFinite(requestedPosition)
        ? Math.max(0, Math.min(targetSet.songs.length, Math.round(requestedPosition) - 1))
        : targetSet.songs.length;
      return current.map((set) => {
        if (set.index !== targetSet.index) return set;
        const nextSongs = [...set.songs];
        nextSongs.splice(insertIndex, 0, song);
        return { ...set, songs: nextSongs };
      });
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
      const next = current.map((set) => ({ ...set, songs: [...set.songs] }));
      const sourceSetPosition = next.findIndex((set) => set.index === setIndex);
      const source = next[sourceSetPosition];
      if (!source) return current;

      if (direction === -1 && songIndex > 0) {
        [source.songs[songIndex - 1], source.songs[songIndex]] = [source.songs[songIndex], source.songs[songIndex - 1]];
        return next;
      }

      if (direction === 1 && songIndex < source.songs.length - 1) {
        [source.songs[songIndex], source.songs[songIndex + 1]] = [source.songs[songIndex + 1], source.songs[songIndex]];
        return next;
      }

      const targetSetPosition = sourceSetPosition + direction;
      const target = next[targetSetPosition];
      if (!target) return current;

      const [song] = source.songs.splice(songIndex, 1);
      if (!song) return current;
      if (direction === -1) target.songs.push(song);
      else target.songs.unshift(song);
      return next;
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

      const next = current.map((set) => ({ ...set, songs: [...set.songs] }));
      const source = next.find((set) => set.index === setIndex);
      const target = next.find((set) => set.index === targetSetIndex);
      if (!source || !target) return current;

      const [song] = source.songs.splice(songIndex, 1);
      if (!song) return current;
      target.songs.push(song);
      return next;
    });
    setDirty(true);
    setAiAnalysis(null);
    setMsg(null);
  }

  function moveDraggedSong(source: DragLocation, target: DragLocation | { setIndex: number; songIndex: "end" }) {
    setSets((current) => {
      const next = current.map((set) => ({ ...set, songs: [...set.songs] }));
      const sourceSet = next.find((set) => set.index === source.setIndex);
      const targetSet = next.find((set) => set.index === target.setIndex);
      if (!sourceSet || !targetSet) return current;
      const [song] = sourceSet.songs.splice(source.songIndex, 1);
      if (!song) return current;

      let insertIndex = target.songIndex === "end" ? targetSet.songs.length : target.songIndex;
      if (source.setIndex === target.setIndex && target.songIndex !== "end" && source.songIndex < target.songIndex) {
        insertIndex -= 1;
      }
      targetSet.songs.splice(Math.max(0, insertIndex), 0, song);
      return next;
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
      body: JSON.stringify({ sets: sets.map((set) => set.songs.map((song) => song.id)) }),
    });
    const json = await r.json().catch(() => null);
    setBusy(false);

    if (!r.ok) {
      setMsg(json?.error ? JSON.stringify(json.error) : await readErrorMessage(r));
      return;
    }

    if (json?.sets) {
      setData(json);
      setSets(json.sets);
    }
    setDirty(false);
    setReplacementPrompt(null);
    setMsg("Saved setlist changes.");
  }

  async function analyzeSetWithAi() {
    if (!data?.setlist || songCount === 0) {
      setMsg("Load a setlist before asking AI to analyze it.");
      return;
    }
    setAiBusy(true);
    setMsg("Analyzing set...");
    try {
      const response = await fetch("/api/ai/analyze-set", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setlistId: id,
          bandId: data.setlist.bandId || undefined,
          venueId: data.setlist.venueId || undefined,
          bandName: data.setlist.bandName ?? undefined,
          venueName: data.setlist.venueName ?? undefined,
          performedAt: data.setlist.performedAt ?? undefined,
          numSets: sets.length,
          sets: sets.map((set) => ({ index: set.index, songs: set.songs.map((song, index) => compactSongForAi(song, set.index, index + 1)) })),
        }),
      });
      const text = await response.text();
      const json = text ? JSON.parse(text) as { ok?: boolean; analysis?: AiSetAnalysis; error?: unknown; incompleteReason?: string | null } : null;
      if (!response.ok || !json?.ok || !json.analysis) {
        const error = typeof json?.error === "string" ? json.error : JSON.stringify(json?.error ?? `AI analysis failed (${response.status}).`);
        setMsg(json?.incompleteReason ? `${error} Reason: ${json.incompleteReason}.` : error);
        return;
      }
      setAiAnalysis(json.analysis);
      setMsg("AI Set Analysis is ready.");
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
    if (!aiAnalysis) return { ok: false, problems: ["No AI recommended order is available."], orderedSets: [] as string[][] };
    const sourceSongs = currentSetSongs;
    const byId = new Map(sourceSongs.map((song) => [song.id, song]));
    const byIdentity = new Map(sourceSongs.map((song) => [normalizeSongKey(song.title, song.artist), song]));
    const usedIds = new Set<string>();
    const problems: string[] = [];
    const orderedSets: string[][] = Array.from({ length: sets.length }, () => []);
    const ordered = [...aiAnalysis.recommendedOrder].sort((a, b) => a.setNumber - b.setNumber || a.position - b.position);

    for (const item of ordered) {
      const song = item.songId ? byId.get(item.songId) : byIdentity.get(normalizeSongKey(item.title, item.artist));
      if (!song) {
        problems.push(`Unknown song: ${item.title} - ${item.artist}`);
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
      orderedSets[item.setNumber - 1].push(song.id);
    }

    for (const song of sourceSongs) {
      if (!usedIds.has(song.id)) problems.push(`Missing song: ${song.title} - ${song.artist}`);
    }
    if (usedIds.size !== sourceSongs.length) problems.push(`Expected ${sourceSongs.length} songs, but AI returned ${usedIds.size} unique matching song${usedIds.size === 1 ? "" : "s"}.`);

    return { ok: problems.length === 0, problems, orderedSets };
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
    setData(detail);
    setSets(detail.sets);
    setDirty(false);
    setReplacementPrompt(null);
    setAiAnalysis(null);
    setMsg("AI recommended order applied.");
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

  function resetOrder() {
    if (!data) return;
    setSets(data.sets);
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
          <div className="print-only mt-2 text-sm">
            <div>Band: {data.setlist.bandName ?? "No band assigned"}</div>
            <div>Venue: {data.setlist.venueName ?? "Unknown venue"}</div>
            <div>Performance date: {formatDate(data.setlist.performedAt)}</div>
            <div>{sets.length} set{sets.length === 1 ? "" : "s"} - {songCount} song{songCount === 1 ? "" : "s"}</div>
          </div>
          <p className="mono mt-1 text-xs text-[var(--muted)]">Total duration: {formatDuration(eventDuration)}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton className="px-3 py-1 text-xs" />
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={exportBusy || songCount === 0} onClick={() => void exportOnSong()}>
            {exportBusy ? "Exporting" : "OnSong Export"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" disabled={aiBusy || busy || songCount === 0} onClick={() => void analyzeSetWithAi()}>
            {aiBusy ? "Analyzing set..." : "AI Analyze Set"}
          </button>
          <button type="button" className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setShowAddSong((value) => !value)}>
            {showAddSong ? "Hide Add Song" : "Add Song"}
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

      {aiAnalysis && <AiSetAnalysisPanel analysis={aiAnalysis} currentSongs={currentSetSongs} onApplyOrder={() => void applyAiRecommendedOrder()} />}

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
                placeholder="Search title or artist"
                value={addSongQuery}
                onChange={(event) => setAddSongQuery(event.target.value)}
              />
              <select className="input mt-2" value={addSongId} onChange={(event) => setAddSongId(event.target.value)}>
                <option value="">Choose song...</option>
                {filteredAddSongs.map((song) => (
                  <option key={song.id} value={song.id}>{song.title} - {song.artist}</option>
                ))}
              </select>
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
            <button type="button" className="btn btn-ghost no-print px-2 py-1 text-xs" onClick={() => reshuffleSet(s.index)}>
              Reshuffle set
            </button>
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
              return (
                <li
                  key={`${s.index}-${song.id}-${songIndex}`}
                  className={`grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-[#0f131a] ${isDragging ? "opacity-50 ring-1 ring-[var(--accent)]" : ""} ${isDropTarget ? "border-t-2 border-[var(--accent)] bg-[#0f131a]" : ""}`}
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
                  </span>
                  {promptIsOpen && (
                    <div className="col-start-3 col-span-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-2">
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




