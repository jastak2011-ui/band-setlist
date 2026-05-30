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

function SongPerformanceRating({ song, busy, onSave }: { song: Song; busy: boolean; onSave: (score: number | null, notes: string | null) => void }) {
  const [score, setScore] = useState(song.performanceRating?.crowdResponseScore?.toString() ?? "");
  const [notes, setNotes] = useState(song.performanceRating?.notes ?? "");

  useEffect(() => {
    setScore(song.performanceRating?.crowdResponseScore?.toString() ?? "");
    setNotes(song.performanceRating?.notes ?? "");
  }, [song.id, song.performanceRating?.crowdResponseScore, song.performanceRating?.notes]);

  const parsedScore = score ? Number(score) : null;
  const validScore = parsedScore == null || (Number.isInteger(parsedScore) && parsedScore >= 1 && parsedScore <= 10);

  return (
    <div className="col-start-2 col-span-2 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-[var(--text)]">Crowd Response</span>
        <input
          className="input h-8 w-20 px-2 py-0 text-xs"
          inputMode="numeric"
          placeholder="1-10"
          value={score}
          onChange={(event) => setScore(event.target.value)}
        />
        <button type="button" className="btn btn-ghost h-8 px-2 py-0 text-xs" onClick={() => setScore("")}>Blank</button>
        <button type="button" className="btn btn-ghost h-8 px-2 py-0 text-xs" onClick={() => setScore("3")}>Poor</button>
        <button type="button" className="btn btn-ghost h-8 px-2 py-0 text-xs" onClick={() => setScore("5")}>Okay</button>
        <button type="button" className="btn btn-ghost h-8 px-2 py-0 text-xs" onClick={() => setScore("7")}>Good</button>
        <button type="button" className="btn btn-ghost h-8 px-2 py-0 text-xs" onClick={() => setScore("9")}>Great</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-64 flex-1 px-2 py-1 text-xs"
          placeholder="Performance note"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary h-8 px-3 py-0 text-xs"
          disabled={busy || !validScore}
          onClick={() => onSave(parsedScore, notes.trim() || null)}
        >
          {busy ? "Saving" : "Save rating"}
        </button>
      </div>
      {!validScore && <div className="mt-1 text-rose-300">Use a whole number from 1 to 10, or leave blank.</div>}
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
  const [ratingBusyKey, setRatingBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const songMap = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const eventDuration = useMemo(() => totalDuration(sets.flatMap((set) => set.songs)), [sets]);
  const songCount = useMemo(() => sets.reduce((sum, set) => sum + set.songs.length, 0), [sets]);

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
    setMsg("Setlist reshuffled. Save the order when it feels right.");
  }

  function reshuffleSet(setIndex: number) {
    setSets((current) =>
      current.map((set) => (set.index === setIndex ? { ...set, songs: shuffleSongs(set.songs) } : set)),
    );
    setDirty(true);
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
    setMsg(message);
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
    setMsg(null);
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

  function resetOrder() {
    if (!data) return;
    setSets(data.sets);
    setDirty(false);
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
          <ol className="no-print space-y-1 text-sm">
            {s.songs.map((song, songIndex) => {
              const usedIds = new Set(sets.flatMap((set) => set.songs.map((item) => item.id)));
              const promptIsOpen = replacementPrompt?.setIndex === s.index && replacementPrompt.songIndex === songIndex;
              const promptIsList = promptIsOpen && replacementPrompt.mode === "list";
              return (
                <li key={`${s.index}-${song.id}-${songIndex}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-2 py-1 hover:bg-[#0f131a]">
                  <span className="mono text-xs text-[var(--muted)]">{songIndex + 1}</span>
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
                    <div className="col-start-2 col-span-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-2">
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
                  <SongPerformanceRating
                    song={song}
                    busy={ratingBusyKey === `${s.index}-${song.id}-${songIndex}`}
                    onSave={(score, notes) => void saveRating(s.index, songIndex, song, score, notes)}
                  />
                </li>
              );
            })}
          </ol>
          <table className="print-only w-full border-collapse text-sm leading-tight">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">Song</th>
                <th className="py-1 pr-2 font-medium">Artist</th>
                <th className="py-1 pr-2 text-right font-medium">BPM</th>
                <th className="py-1 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.songs.map((song, songIndex) => (
                <tr key={`print-${s.index}-${song.id}-${songIndex}`} className="border-b border-[var(--border)]">
                  <td className="py-1 pr-2 align-top">{songIndex + 1}</td>
                  <td className="py-1 pr-2 align-top font-medium">{song.title}</td>
                  <td className="py-1 pr-2 align-top">{song.artist}</td>
                  <td className="py-1 pr-2 text-right align-top font-medium">{song.bpm ?? "-"}</td>
                  <td className="py-1 align-top">{song.notes || ""}</td>
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




