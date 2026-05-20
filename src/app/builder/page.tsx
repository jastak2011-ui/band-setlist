"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Song = { id: string; title: string; artist: string; bpm: number | null; durationSec: number | null };
type SetlistStrategy = "balanced" | "high-energy" | "dance-heavy" | "singalong-heavy" | "acoustic-chill" | "build-slowly";
type Band = { id: string; name: string };
type Venue = { id: string; name: string };
type BuiltSong = { position: number; id: string; title: string; artist: string; bpm: number | null; durationSec: number | null; importIndex?: number };
type Built = { index: number; songs: BuiltSong[] };
type ImportedSong = { title: string; artist: string; setIndex: number; importIndex: number };
type ImportSummary = { total: number; matched: number; unmatched: ImportedSong[] };


function normalizeForMatch(value: string) {
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

function tokenScore(a: string, b: string) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aTokenList = a.split(" ").filter(Boolean);
  const bTokenList = b.split(" ").filter(Boolean);
  if (aTokenList.length > 1 || bTokenList.length > 1) {
    const paddedA = ` ${a} `;
    const paddedB = ` ${b} `;
    if (paddedA.includes(paddedB) || paddedB.includes(paddedA)) return 0.9;
  }

  const aTokens = new Set(aTokenList);
  const bTokens = new Set(bTokenList);
  const union = new Set([...aTokens, ...bTokens]);
  if (union.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap++;
  return overlap / union.size;
}

function matchImportedSong(imported: ImportedSong, library: Song[], usedIds: Set<string>) {
  const importedTitle = normalizeForMatch(imported.title);
  const importedArtist = normalizeForMatch(imported.artist);
  const importedTitleTokens = importedTitle.split(" ").filter(Boolean);
  let best: { song: Song; score: number; titleScore: number; artistScore: number } | null = null;

  for (const song of library) {
    if (usedIds.has(song.id)) continue;
    const titleScore = tokenScore(importedTitle, normalizeForMatch(song.title));
    const artistScore = importedArtist ? tokenScore(importedArtist, normalizeForMatch(song.artist)) : 0.5;
    const combinedScore = titleScore * 0.75 + artistScore * 0.25;
    if (!best || combinedScore > best.score) best = { song, score: combinedScore, titleScore, artistScore };
  }

  if (!best) return null;
  const shortSingleWordTitle = importedTitleTokens.length === 1 && importedTitle.length <= 4;
  if (best.titleScore < 0.55) return null;
  if (shortSingleWordTitle && importedArtist && best.artistScore < 0.5) return null;
  return best.score >= 0.72 ? best.song : null;
}

function parseImportedSongsFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(doc.querySelectorAll("tbody tr"));
  const imported: ImportedSong[] = [];
  let currentSet = 1;
  let setCount = 1;

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "");
    const [title = "", artist = ""] = cells;
    if (!title) continue;
    if (!artist && /^set\s+\d+/i.test(title)) {
      const parsedSet = Number(title.match(/\d+/)?.[0] ?? "1");
      if (Number.isFinite(parsedSet) && parsedSet > 0) {
        currentSet = parsedSet;
        setCount = Math.max(setCount, parsedSet);
      }
      continue;
    }
    imported.push({ title, artist, setIndex: currentSet, importIndex: imported.length });
  }

  return { imported, setCount };
}
function todayForDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatTitleDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function totalDuration(songs: { durationSec: number | null }[]) {
  return songs.reduce((sum, song) => sum + (song.durationSec ?? 0), 0);
}

function shuffleSongs(songs: BuiltSong[]) {
  const shuffled = [...songs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function clampSetCount(value: number) {
  return Math.max(1, Math.min(12, Number.isFinite(value) ? Math.round(value) : 1));
}

function distributeSongs(songs: BuiltSong[], numSets: number): Built[] {
  const setCount = clampSetCount(numSets);
  const sets: Built[] = Array.from({ length: setCount }, (_, i) => ({ index: i + 1, songs: [] }));
  songs.forEach((song, index) => sets[index % setCount].songs.push(song));
  return sets.map((set) => ({ ...set, songs: set.songs.map((song, index) => ({ ...song, position: index + 1 })) }));
}

function chunkSongsInOrder(songs: BuiltSong[], numSets: number): Built[] {
  const setCount = clampSetCount(numSets);
  const sets: Built[] = Array.from({ length: setCount }, (_, i) => ({ index: i + 1, songs: [] }));
  const baseSize = Math.floor(songs.length / setCount);
  let remainder = songs.length % setCount;
  let cursor = 0;

  for (const set of sets) {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    set.songs = songs.slice(cursor, cursor + size).map((song, index) => ({ ...song, position: index + 1 }));
    cursor += size;
  }

  return sets;
}

function flattenSetsInOrder(sets: Built[]) {
  return [...sets]
    .sort((a, b) => a.index - b.index)
    .flatMap((set) => [...set.songs].sort((a, b) => a.position - b.position));
}

function fitImportedSetsToCount(importedSets: Built[], targetCount: number) {
  const setCount = clampSetCount(targetCount);
  if (importedSets.length === setCount) {
    return importedSets.map((set, index) => ({
      index: index + 1,
      songs: set.songs.map((song, songIndex) => ({ ...song, position: songIndex + 1 })),
    }));
  }

  return chunkSongsInOrder(flattenSetsInOrder(importedSets), setCount);
}

export default function BuilderPage() {
  const router = useRouter();
  const [songs, setSongs] = useState<Song[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bandId, setBandId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [performedAt, setPerformedAt] = useState(todayForDateInput);
  const [numSets, setNumSets] = useState(2);
  const [strategy, setStrategy] = useState<SetlistStrategy>("balanced");
  const [avoidSameArtist, setAvoidSameArtist] = useState(true);
  const [avoidSameGenre, setAvoidSameGenre] = useState(true);
  const [avoidBigBpmDrops, setAvoidBigBpmDrops] = useState(true);
  const [avoidHardVocals, setAvoidHardVocals] = useState(true);
  const [saveStrongestForLater, setSaveStrongestForLater] = useState(true);
  const [sets, setSets] = useState<Built[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [addingImportKey, setAddingImportKey] = useState<string | null>(null);
  const [replacementPool, setReplacementPool] = useState<BuiltSong[]>([]);
  const [replacementCursor, setReplacementCursor] = useState(0);

  const updateReplacementPool = useCallback((rows: BuiltSong[]) => {
    setReplacementPool(rows);
    setReplacementCursor(0);
  }, []);

  const selectedBand = useMemo(() => bands.find((band) => band.id === bandId) ?? null, [bandId, bands]);
  const selectedVenue = useMemo(() => venues.find((venue) => venue.id === venueId) ?? null, [venueId, venues]);
  const generatedTitle = selectedBand && selectedVenue && performedAt ? `${selectedBand.name} - ${selectedVenue.name} - ${formatTitleDate(performedAt)}` : "";

  const load = useCallback(async () => {
    const [sr, br, vr] = await Promise.all([fetch("/api/songs"), fetch("/api/bands"), fetch("/api/venues")]);
    setSongs(await sr.json());
    setBands(await br.json());
    setVenues(await vr.json());
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function changeNumSets(value: number) {
    const nextCount = clampSetCount(value);
    setNumSets(nextCount);
    if (importSummary) {
      setSets((current) => (current ? fitImportedSetsToCount(current, nextCount) : current));
    }
  }

  async function importSongList(file: File | null) {
    if (!file) return;
    setMsg(null);
    setSets(null);

    const html = await file.text();
    const { imported, setCount } = parseImportedSongsFromHtml(html);
    if (imported.length === 0) {
      setImportSummary({ total: 0, matched: 0, unmatched: [] });
      setMsg("No songs were found in that import file.");
      return;
    }

    const usedIds = new Set<string>();
    const matchedIds: string[] = [];
    const unmatched: ImportedSong[] = [];
    const importedSets: Built[] = Array.from({ length: setCount }, (_, index) => ({ index: index + 1, songs: [] }));
    for (const importedSong of imported) {
      const match = matchImportedSong(importedSong, songs, usedIds);
      if (match) {
        usedIds.add(match.id);
        matchedIds.push(match.id);
        const targetSet = importedSets[importedSong.setIndex - 1] ?? importedSets[0];
        targetSet.songs.push({ ...match, position: targetSet.songs.length + 1, importIndex: importedSong.importIndex });
      } else {
        unmatched.push(importedSong);
      }
    }

    const fittedSets = fitImportedSetsToCount(importedSets, numSets);
    setSelected(new Set(matchedIds));
    setSets(matchedIds.length > 0 ? fittedSets : null);
    setImportSummary({ total: imported.length, matched: matchedIds.length, unmatched });
    setMsg(`Imported ${matchedIds.length} of ${imported.length} songs from ${file.name} in file order using ${clampSetCount(numSets)} set${clampSetCount(numSets) === 1 ? "" : "s"}. Review the sets, then save or adjust them.`);
  }

  async function addUnmatchedSong(importedSong: ImportedSong) {
    const key = `${importedSong.setIndex}-${importedSong.importIndex}-${importedSong.title}-${importedSong.artist}`;
    setAddingImportKey(key);
    setMsg(null);

    const response = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: importedSong.title, artist: importedSong.artist || "Unknown Artist" }),
    });
    const created = await response.json().catch(() => null) as Song | null;
    setAddingImportKey(null);

    if (!response.ok || !created) {
      setMsg(created ? JSON.stringify(created) : "Could not add song to the library.");
      return;
    }

    setSongs((current) => [...current, created].sort((a, b) => a.title.localeCompare(b.title)));
    setSelected((current) => new Set([...current, created.id]));
    setImportSummary((current) => current ? {
      ...current,
      matched: current.matched + 1,
      unmatched: current.unmatched.filter((song) => song.importIndex !== importedSong.importIndex),
    } : current);
    setSets((current) => {
      const setCount = clampSetCount(numSets);
      const next = current ? fitImportedSetsToCount(current, setCount) : Array.from({ length: setCount }, (_, index) => ({ index: index + 1, songs: [] as BuiltSong[] }));
      const targetIndex = Math.min(importedSong.setIndex, setCount) - 1;
      const targetSet = next[targetIndex];
      targetSet.songs.push({ ...created, position: targetSet.songs.length + 1, importIndex: importedSong.importIndex });
      targetSet.songs = targetSet.songs
        .sort((a, b) => (a.importIndex ?? Number.MAX_SAFE_INTEGER) - (b.importIndex ?? Number.MAX_SAFE_INTEGER))
        .map((song, index) => ({ ...song, position: index + 1 }));
      return next;
    });
    setMsg(`Added ${created.title} to the library and Set ${Math.min(importedSong.setIndex, clampSetCount(numSets))}.`);
  }
  async function build() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/build-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songIds: Array.from(selected),
        numSets,
        venueId: venueId || undefined,
        bandId: bandId || undefined,
        strategy,
        avoidSameArtist,
        avoidSameGenre,
        avoidBigBpmDrops,
        avoidHardVocals,
        saveStrongestForLater,
      }),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) {
      setMsg(data.error ? JSON.stringify(data.error) : "Build failed");
      return;
    }
    setImportSummary(null);
    setSets(data.sets);
  }

  function reshuffle() {
    if (!sets) return;
    setSets(distributeSongs(shuffleSongs(sets.flatMap((set) => set.songs)), sets.length));
    setMsg("Sets reshuffled.");
  }

  function replaceSong(setIndex: number, songId: string) {
    if (!sets) return;
    if (replacementPool.length === 0) {
      setMsg("No suggested replacement songs are available yet.");
      return;
    }

    const usedIds = new Set(sets.flatMap((set) => set.songs.map((song) => song.id)));
    usedIds.delete(songId);

    let replacement: BuiltSong | null = null;
    let nextCursor = replacementCursor;
    for (let i = 0; i < replacementPool.length; i++) {
      const candidateIndex = (replacementCursor + i) % replacementPool.length;
      const candidate = replacementPool[candidateIndex];
      if (!usedIds.has(candidate.id)) {
        replacement = candidate;
        nextCursor = (candidateIndex + 1) % replacementPool.length;
        break;
      }
    }

    if (!replacement) {
      setMsg("No unused suggested replacement songs available.");
      return;
    }

    let previousTitle = "song";
    setSets((current) =>
      current?.map((set) =>
        set.index === setIndex
          ? {
              ...set,
              songs: set.songs.map((song) => {
                if (song.id !== songId) return song;
                previousTitle = song.title;
                return { ...replacement, position: song.position };
              }),
            }
          : set,
      ) ?? null,
    );
    setReplacementCursor(nextCursor);
    setMsg(`Replaced ${previousTitle} with ${replacement.title}. Click Replace again to try another song in that slot.`);
  }

  const saveRequirements = [
    !bandId ? "band" : null,
    !venueId ? "venue" : null,
    !performedAt ? "performance date" : null,
  ].filter(Boolean);
  const saveHint = sets && saveRequirements.length > 0 ? `Choose a ${saveRequirements.join(", ")} before saving.` : null;

  async function save() {
    if (!sets || !bandId || !venueId) {
      setMsg("Pick a band and venue before saving.");
      return;
    }
    if (!performedAt) {
      setMsg("Pick a performance date before saving.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/setlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandId, venueId, title: generatedTitle, performedAt: `${performedAt}T12:00:00`, sets: sets.map((s) => s.songs.map((x) => x.id)) }),
    });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setMsg(data?.error ? JSON.stringify(data.error) : "Save failed.");
      return;
    }
    setMsg(`Saved ${generatedTitle} to history.`);
    if (data?.id) router.push(`/history/${data.id}`);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Set builder</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Select songs, choose a band and venue, then build balanced sets.</p>
      </div>

      {msg && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">{msg}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card max-h-[520px] overflow-y-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-medium">Pool ({selected.size} selected)</h2>
            <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(new Set(songs.map((s) => s.id)))}>All</button>
          </div>
          <ul className="space-y-1 text-sm">
            {songs.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-[#0f131a]">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                  <span>
                    {s.title} <span className="text-[var(--muted)]">- {s.artist}</span>
                    {s.bpm != null && <span className="mono ml-2 text-xs text-[var(--muted)]">{s.bpm} bpm</span>}
                    {s.durationSec != null && <span className="mono ml-2 text-xs text-[var(--muted)]">{formatDuration(s.durationSec)}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <label className="block text-sm text-[var(--muted)]">
              Band
              <select className="input mt-1" value={bandId} onChange={(e) => setBandId(e.target.value)}>
                <option value="">Select a band</option>
                {bands.map((band) => <option key={band.id} value={band.id}>{band.name}</option>)}
              </select>
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Venue (for rotation + saving)
              <select className="input mt-1" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Optional for preview</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Performance date
              <input type="date" className="input mt-1" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Number of sets
              <input type="number" min={1} max={12} className="input mt-1" value={numSets} onChange={(e) => changeNumSets(Number(e.target.value))} />
            </label>
            <div className="rounded-lg border border-[var(--border)] px-3 py-3">
              <label className="block text-sm text-[var(--muted)]">
                Setlist strategy
                <select className="input mt-1" value={strategy} onChange={(e) => setStrategy(e.target.value as SetlistStrategy)}>
                  <option value="balanced">Balanced</option>
                  <option value="high-energy">High energy</option>
                  <option value="dance-heavy">Dance-heavy</option>
                  <option value="singalong-heavy">Singalong-heavy</option>
                  <option value="acoustic-chill">Acoustic/chill</option>
                  <option value="build-slowly">Build slowly</option>
                </select>
              </label>
              <div className="mt-3 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={avoidSameArtist} onChange={(e) => setAvoidSameArtist(e.target.checked)} /> Avoid same artist back-to-back</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={avoidSameGenre} onChange={(e) => setAvoidSameGenre(e.target.checked)} /> Avoid same genre back-to-back</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={avoidBigBpmDrops} onChange={(e) => setAvoidBigBpmDrops(e.target.checked)} /> Avoid big BPM drops</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={avoidHardVocals} onChange={(e) => setAvoidHardVocals(e.target.checked)} /> Avoid hard vocal songs back-to-back</label>
                <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={saveStrongestForLater} onChange={(e) => setSaveStrongestForLater(e.target.checked)} /> Save strongest songs for later</label>
              </div>
            </div>
            {generatedTitle && <div className="text-xs text-[var(--muted)]">History title: {generatedTitle}</div>}
            <div className="rounded-lg border border-[var(--border)] px-3 py-3">
              <label className="block text-sm text-[var(--muted)]">
                Import setlist HTML
                <input
                  type="file"
                  accept=".html,.htm,text/html"
                  className="input mt-1"
                  onChange={(event) => void importSongList(event.target.files?.[0] ?? null)}
                />
              </label>
              {importSummary && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  Matched {importSummary.matched} of {importSummary.total} imported songs.
                  {importSummary.unmatched.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-rose-300">Review {importSummary.unmatched.length} unmatched song{importSummary.unmatched.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-2 space-y-1">
                        {importSummary.unmatched.map((song, index) => {
                          const key = `${song.setIndex}-${song.importIndex}-${song.title}-${song.artist}`;
                          return (
                            <li key={`${song.title}-${song.artist}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-2 py-1">
                              <span>Set {song.setIndex}: {song.title}{song.artist && ` - ${song.artist}`}</span>
                              <button
                                type="button"
                                className="btn btn-ghost px-2 py-1 text-xs"
                                disabled={addingImportKey === key}
                                onClick={() => void addUnmatchedSong(song)}
                              >
                                {addingImportKey === key ? "Adding..." : "Add to library"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
            <button type="button" disabled={busy || selected.size === 0} className="btn btn-primary w-full" onClick={() => void build()}>{busy ? "Working..." : sets ? "Rebuild sets" : "Build sets"}</button>
          </div>

          {sets && (
            <div className="card space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">Built sets</h2>
                <button type="button" disabled={busy} className="btn btn-ghost px-3 py-1 text-xs" onClick={reshuffle}>Reshuffle sets</button>
              </div>
              {sets.map((st) => {
                const setDuration = totalDuration(st.songs);
                return (
                  <div key={st.index}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-[var(--accent)]">Set {st.index}</h3>
                      <span className="mono text-xs text-[var(--muted)]">Total: {formatDuration(setDuration)}</span>
                    </div>
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {st.songs.map((song) => (
                        <li key={`${st.index}-${song.id}`} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {song.title} <span className="text-[var(--muted)]">- {song.artist}{song.bpm != null && <span className="mono text-xs"> ({song.bpm} bpm)</span>}{song.durationSec != null && <span className="mono text-xs"> - {formatDuration(song.durationSec)}</span>}</span>
                          </span>
                          <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => replaceSong(st.index, song.id)}>Replace</button>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
              {saveHint && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{saveHint}</div>}
              <button type="button" disabled={busy || !sets} className="btn btn-primary w-full" onClick={() => void save()}>{busy ? "Saving..." : "Save to history"}</button>
            </div>
          )}
        </div>
      </div>

      {venueId && bandId && (
        <Recommendations
          venueId={venueId}
          bandId={bandId}
          onPickMany={(ids) => setSelected(new Set(ids))}
          onRows={updateReplacementPool}
        />
      )}
    </div>
  );
}

function Recommendations({ venueId, bandId, onPickMany, onRows }: { venueId: string; bandId: string; onPickMany: (ids: string[]) => void; onRows: (rows: BuiltSong[]) => void }) {
  type RecommendationRow = { id: string; title: string; artist: string; bpm: number | null; durationSec: number | null; recentPlaysAtVenue: number };
  type ReplacementPrompt = { songId: string; mode: "choices" | "list" };

  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [targetHours, setTargetHours] = useState("1");
  const [bufferMinutes, setBufferMinutes] = useState("1");
  const [replaceCursor, setReplaceCursor] = useState(0);
  const [replacementPrompt, setReplacementPrompt] = useState<ReplacementPrompt | null>(null);

  const publishRows = useCallback((nextRows: RecommendationRow[]) => {
    onRows(nextRows.map((row, index) => ({ ...row, position: index + 1 })));
  }, [onRows]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seed = Date.now();
      const r = await fetch(`/api/recommendations?venueId=${encodeURIComponent(venueId)}&bandId=${encodeURIComponent(bandId)}&seed=${seed}`);
      const data = await r.json();
      if (!cancelled && data.ranked) {
        setRows(data.ranked);
        setReplaceCursor(0);
        setReplacementPrompt(null);
        publishRows(data.ranked);
      }
    })();
    return () => { cancelled = true; };
  }, [bandId, publishRows, venueId]);

  if (rows.length === 0) return null;

  const targetSeconds = Math.max(0, Number(targetHours) || 0) * 3600;
  const bufferSeconds = Math.max(0, Number(bufferMinutes) || 0) * 60;
  const pickedForDuration: string[] = [];
  let pickedSongSeconds = 0;
  let pickedBufferSeconds = 0;
  for (const row of rows) {
    if (targetSeconds > 0 && pickedSongSeconds + pickedBufferSeconds >= targetSeconds) break;
    pickedForDuration.push(row.id);
    pickedSongSeconds += row.durationSec ?? 0;
    if (pickedForDuration.length > 1) pickedBufferSeconds += bufferSeconds;
  }
  const pickedSeconds = pickedSongSeconds + pickedBufferSeconds;
  const previewLimit = Math.max(25, pickedForDuration.length);
  const previewRows = rows.slice(0, previewLimit);

  function replaceSuggestedPick(songId: string) {
    const currentRows = rows;
    const visibleLimit = Math.min(previewLimit, currentRows.length);
    const visibleIndex = currentRows.findIndex((row, index) => index < visibleLimit && row.id === songId);
    if (visibleIndex < 0 || currentRows.length <= visibleLimit) return false;

    const hiddenCount = currentRows.length - visibleLimit;
    const start = visibleLimit + (replaceCursor % hiddenCount);
    const visibleIds = new Set(currentRows.slice(0, visibleLimit).map((row) => row.id));
    let replacementIndex = -1;
    for (let i = 0; i < hiddenCount; i++) {
      const candidateIndex = visibleLimit + ((start - visibleLimit + i) % hiddenCount);
      if (!visibleIds.has(currentRows[candidateIndex].id)) {
        replacementIndex = candidateIndex;
        break;
      }
    }

    if (replacementIndex < 0) return false;

    const nextRows = [...currentRows];
    [nextRows[visibleIndex], nextRows[replacementIndex]] = [nextRows[replacementIndex], nextRows[visibleIndex]];
    setReplaceCursor(visibleLimit + ((replacementIndex - visibleLimit + 1) % hiddenCount));
    setRows(nextRows);
    setReplacementPrompt(null);
    publishRows(nextRows);
    return true;
  }

  function replaceSuggestedPickWith(songId: string, replacementId: string) {
    if (!replacementId || replacementId === songId) {
      setReplacementPrompt(null);
      return;
    }

    const currentRows = rows;
    const visibleLimit = Math.min(previewLimit, currentRows.length);
    const visibleIndex = currentRows.findIndex((row, index) => index < visibleLimit && row.id === songId);
    const replacementIndex = currentRows.findIndex((row) => row.id === replacementId);
    if (visibleIndex < 0 || replacementIndex < 0) return;

    const nextRows = [...currentRows];
    [nextRows[visibleIndex], nextRows[replacementIndex]] = [nextRows[replacementIndex], nextRows[visibleIndex]];
    setRows(nextRows);
    setReplacementPrompt(null);
    publishRows(nextRows);
  }

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Suggested next picks at this venue for this band</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--muted)]">
            Target hours
            <input className="input ml-2 inline-block w-24 px-2 py-1 text-xs" type="number" min="0.25" step="0.25" value={targetHours} onChange={(e) => setTargetHours(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Buffer min/song
            <input className="input ml-2 inline-block w-20 px-2 py-1 text-xs" type="number" min="0" step="0.25" value={bufferMinutes} onChange={(e) => setBufferMinutes(e.target.value)} />
          </label>
          <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onPickMany(pickedForDuration)}>
            Select {pickedForDuration.length} ({formatDuration(pickedSeconds)})
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-[var(--muted)]">
        Lower recent plays means less repetition for this band at this venue. Showing {previewRows.length} picks. Selected time includes {formatDuration(pickedSongSeconds)} of songs plus {formatDuration(pickedBufferSeconds)} of between-song buffer.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {previewRows.map((r) => {
          const promptIsOpen = replacementPrompt?.songId === r.id;
          const promptIsList = promptIsOpen && replacementPrompt.mode === "list";
          return (
            <li key={r.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  {r.title} <span className="text-[var(--muted)]">- {r.artist}</span>
                  <div className="mono mt-1 text-xs text-[var(--muted)]">recent plays: {r.recentPlaysAtVenue} {r.durationSec != null && `- ${formatDuration(r.durationSec)}`}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-xs"
                  onClick={() => setReplacementPrompt(promptIsOpen ? null : { songId: r.id, mode: "choices" })}
                >
                  Replace
                </button>
              </div>
              {promptIsOpen && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-2">
                  <button type="button" className="btn btn-primary h-8 px-3 py-0 text-xs" onClick={() => replaceSuggestedPick(r.id)}>
                    Auto replace
                  </button>
                  <button type="button" className="btn btn-ghost h-8 px-3 py-0 text-xs" onClick={() => setReplacementPrompt({ songId: r.id, mode: "list" })}>
                    Select from list
                  </button>
                  <button type="button" className="btn btn-ghost h-8 px-3 py-0 text-xs" onClick={() => setReplacementPrompt(null)}>
                    Cancel
                  </button>
                  {promptIsList && (
                    <select className="input h-8 min-w-64 px-2 py-0 text-xs" value="" onChange={(event) => replaceSuggestedPickWith(r.id, event.target.value)}>
                      <option value="">Choose replacement song...</option>
                      {rows.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.title} - {option.artist}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}








