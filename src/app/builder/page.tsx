"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readArrayResponse, readObjectResponse } from "@/app/client-fetch";
import { isHolidayActiveDate, isHolidayGenre } from "@/lib/seasonality";

type Song = { id: string; title: string; artist: string; bpm: number | null; durationSec: number | null; genre: string | null };
type SetlistStrategy = "balanced" | "high-energy" | "dance-heavy" | "singalong-heavy" | "acoustic-chill" | "build-slowly";
type SetBuildEventType = "bar-crowd" | "brewery" | "private-party" | "wedding" | "corporate-event";
type Band = { id: string; name: string };
type Venue = { id: string; name: string };
type BuiltSong = { position: number; id: string; title: string; artist: string; bpm: number | null; durationSec: number | null; genre?: string | null; importIndex?: number };
type Built = { index: number; songs: BuiltSong[] };
type SetAnalysisReason = { setIndex: number; songId: string; title: string; reasons: string[] };
type SetAnalysisScore = { songId: string; title: string; score: number };
type SetAnalysis = {
  openerReasons: SetAnalysisReason[];
  closerReasons: SetAnalysisReason[];
  topEngagementSongs: SetAnalysisScore[];
  peakHourSongs: SetAnalysisScore[];
  energyFlowMoves: string[];
  audienceAgeDistribution: Array<{ age: string; count: number }>;
  averageEngagementScore: number;
  averageEnergyScore: number;
  excludedHolidaySongs: Array<{ songId: string; title: string }>;
  eventType: { value: SetBuildEventType; label: string; priorities: string[] };
};
type ImportedSong = { title: string; artist: string; setIndex: number; importIndex: number };
type ImportSummary = { total: number; matched: number; unmatched: ImportedSong[]; detected?: ImportDetectedMetadata };
type ImportDetectedMetadata = { fileName: string; bandName: string | null; venueName: string | null; performanceDate: string | null; setCount: number };


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

function normalizeForMatch(value: string) {
  return normalizeNameForMatch(value);
}

function compactNameForMatch(value: string) {
  return normalizeNameForMatch(value).replace(/\s+/g, "");
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

function parseDateTokenFromFileName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const match = stem.match(/(?:^|\D)(\d{8}|\d{6})(?:\D|$)/);
  if (!match) return null;

  const token = match[1];
  const month = Number(token.slice(0, 2));
  const day = Number(token.slice(2, 4));
  const year = token.length === 6 ? 2000 + Number(token.slice(4, 6)) : Number(token.slice(4, 8));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return {
    token,
    inputValue: `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
  };
}

function matchNamedItem<T extends { id: string; name: string }>(items: T[], text: string) {
  const normalizedText = normalizeNameForMatch(text);
  const compactText = compactNameForMatch(text);
  let best: { item: T; score: number } | null = null;

  for (const item of items) {
    const normalizedName = normalizeNameForMatch(item.name);
    const compactName = compactNameForMatch(item.name);
    if (!normalizedName || !compactName) continue;

    let score = 0;
    if (compactText === compactName) score = 10000;
    else if (compactText.startsWith(compactName)) score = 8000 + compactName.length;
    else if (compactText.includes(compactName)) score = 5000 + compactName.length;
    else {
      const fuzzyScore = tokenScore(normalizedName, normalizedText);
      if (fuzzyScore >= 0.75) score = fuzzyScore * 1000 + compactName.length;
    }

    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }

  return best?.item ?? null;
}

function removeMatchedPrefix(text: string, matchedName: string | null) {
  if (!matchedName) return text;
  const normalizedText = normalizeNameForMatch(text);
  const normalizedName = normalizeNameForMatch(matchedName);
  return normalizedText.startsWith(normalizedName) ? normalizedText.slice(normalizedName.length).trim() : text;
}

function parseMetadataFromFileName(fileName: string, bands: Band[], venues: Venue[]): ImportDetectedMetadata {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const date = parseDateTokenFromFileName(fileName);
  const nameWithoutDate = date ? stem.replace(date.token, " ") : stem;
  const matchedBand = matchNamedItem(bands, nameWithoutDate);
  const venueSearchText = removeMatchedPrefix(nameWithoutDate, matchedBand?.name ?? null);
  const matchedVenue = matchNamedItem(venues, venueSearchText) ?? matchNamedItem(venues, nameWithoutDate);

  return {
    fileName,
    bandName: matchedBand?.name ?? null,
    venueName: matchedVenue?.name ?? null,
    performanceDate: date?.inputValue ?? null,
    setCount: 1,
  };
}

function detectSetMarkersFromImportedRows(title: string) {
  const normalized = normalizeNameForMatch(title);
  const match = normalized.match(/^set\s*(\d+)$/i);
  if (!match) return null;
  const setNumber = Number(match[1]);
  return Number.isFinite(setNumber) && setNumber > 0 ? setNumber : null;
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

    const markerSet = detectSetMarkersFromImportedRows(title);
    if (markerSet) {
      currentSet = markerSet;
      setCount = Math.max(setCount, markerSet);
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

function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString();
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed (${response.status})`;
  try {
    const data = JSON.parse(text);
    return typeof data?.error === "string" ? data.error : JSON.stringify(data);
  } catch {
    return text;
  }
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

function formatScore(value: number | null | undefined) {
  return value == null ? "-" : `${value}/10`;
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

function SetAnalysisPanel({ analysis }: { analysis: SetAnalysis }) {
  const topEngagement = analysis.topEngagementSongs.slice(0, 5);
  return (
    <details className="rounded-lg border border-[var(--border)] bg-[#0f131a]/50 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-[var(--accent)]">Set Analysis</summary>
      <div className="mt-3 space-y-4">
        <div className="rounded-md border border-[var(--border)] px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Built for</div>
          <div className="mt-1 font-medium">{analysis.eventType.label}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">Priorities: {analysis.eventType.priorities.join(" · ")}</div>
        </div>
        {analysis.excludedHolidaySongs.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Excluded {analysis.excludedHolidaySongs.length} Holiday song{analysis.excludedHolidaySongs.length === 1 ? "" : "s"} outside the holiday season.
            <span className="ml-1 text-[var(--muted)]">
              {analysis.excludedHolidaySongs.map((song) => song.title).join(", ")}
            </span>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Average engagement</div>
            <div className="mt-1 font-medium">{formatScore(analysis.averageEngagementScore)}</div>
          </div>
          <div className="rounded-md border border-[var(--border)] px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Average energy</div>
            <div className="mt-1 font-medium">{formatScore(analysis.averageEnergyScore)}</div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AnalysisReasonList title="Why opener was selected" rows={analysis.openerReasons} emptyText="No opener analysis returned." />
          <AnalysisReasonList title="Why closer was selected" rows={analysis.closerReasons} emptyText="No closer analysis returned." />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AnalysisScoreList title="Top 5 engagement songs" rows={topEngagement} emptyText="No engagement scores returned." />
          <AnalysisScoreList title="Peak-hour songs identified" rows={analysis.peakHourSongs} emptyText="No peak-hour songs identified." />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Songs moved for energy-flow reasons</h3>
            {analysis.energyFlowMoves.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
                {analysis.energyFlowMoves.map((move) => <li key={move}>{move}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted)]">No energy-flow moves flagged.</p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Audience age distribution</h3>
            {analysis.audienceAgeDistribution.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {analysis.audienceAgeDistribution.map((item) => (
                  <span key={item.age} className="rounded-full border border-[var(--border)] px-2 py-1 text-xs">
                    {item.age}: {item.count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted)]">No age appeal metadata available.</p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function AnalysisReasonList({ title, rows, emptyText }: { title: string; rows: SetAnalysisReason[]; emptyText: string }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      {rows.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={`${row.setIndex}-${row.songId}`}>
              <div className="font-medium">Set {row.setIndex}: {row.title}</div>
              <div className="text-xs text-[var(--muted)]">{row.reasons.join(" · ")}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">{emptyText}</p>
      )}
    </div>
  );
}

function AnalysisScoreList({ title, rows, emptyText }: { title: string; rows: SetAnalysisScore[]; emptyText: string }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      {rows.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {rows.map((row) => (
            <li key={row.songId}>
              <span className="font-medium">{row.title}</span>
              <span className="text-xs text-[var(--muted)]"> · {formatScore(row.score)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted)]">{emptyText}</p>
      )}
    </div>
  );
}

export default function BuilderPage() {
  const router = useRouter();
  const [songs, setSongs] = useState<Song[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [holidayOverrideIds, setHolidayOverrideIds] = useState<Set<string>>(new Set());
  const [bandId, setBandId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [performedAt, setPerformedAt] = useState(todayForDateInput);
  const [numSets, setNumSets] = useState(2);
  const [strategy, setStrategy] = useState<SetlistStrategy>("balanced");
  const [eventType, setEventType] = useState<SetBuildEventType>("bar-crowd");
  const [avoidSameArtist, setAvoidSameArtist] = useState(true);
  const [avoidSameGenre, setAvoidSameGenre] = useState(true);
  const [avoidBigBpmDrops, setAvoidBigBpmDrops] = useState(true);
  const [avoidHardVocals, setAvoidHardVocals] = useState(true);
  const [saveStrongestForLater, setSaveStrongestForLater] = useState(true);
  const [sets, setSets] = useState<Built[] | null>(null);
  const [setAnalysis, setSetAnalysis] = useState<SetAnalysis | null>(null);
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
  const holidayOverridesOutsideSeason = useMemo(() => {
    if (isHolidayActiveDate(performedAt)) return [];
    return songs.filter((song) => holidayOverrideIds.has(song.id) && selected.has(song.id) && isHolidayGenre(song.genre));
  }, [holidayOverrideIds, performedAt, selected, songs]);

  const load = useCallback(async () => {
    try {
      const [sr, br, vr] = await Promise.all([
        fetch("/api/songs", { cache: "no-store" }),
        fetch("/api/bands", { cache: "no-store" }),
        fetch("/api/venues", { cache: "no-store" }),
      ]);
      setSongs(await readArrayResponse<Song>(sr, router, "Songs"));
      setBands(await readArrayResponse<Band>(br, router, "Bands"));
      setVenues(await readArrayResponse<Venue>(vr, router, "Venues"));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed to load builder data.");
      setSongs([]);
      setBands([]);
      setVenues([]);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    const song = songs.find((row) => row.id === id);
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        setHolidayOverrideIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      } else {
        n.add(id);
        if (song && isHolidayGenre(song.genre)) {
          setHolidayOverrideIds((current) => new Set([...current, id]));
        }
      }
      return n;
    });
  }

  function selectAllSongs() {
    setSelected(new Set(songs.map((s) => s.id)));
    setHolidayOverrideIds(new Set());
  }

  function changeNumSets(value: number) {
    const nextCount = clampSetCount(value);
    setNumSets(nextCount);
    setSetAnalysis(null);
    if (importSummary) {
      setSets((current) => (current ? fitImportedSetsToCount(current, nextCount) : current));
    }
  }

  async function importSongList(file: File | null) {
    if (!file) return;
    setMsg(null);
    setSets(null);
    setSetAnalysis(null);

    const html = await file.text();
    const detected = parseMetadataFromFileName(file.name, bands, venues);
    const { imported, setCount } = parseImportedSongsFromHtml(html);
    const detectedWithSets = { ...detected, setCount };
    console.info("Setlist import detected metadata", detectedWithSets);
    if (detected.bandName) setBandId(bands.find((band) => band.name === detected.bandName)?.id ?? "");
    if (detected.venueName) setVenueId(venues.find((venue) => venue.name === detected.venueName)?.id ?? "");
    if (detected.performanceDate) setPerformedAt(detected.performanceDate);
    setNumSets(setCount);

    if (imported.length === 0) {
      setImportSummary({ total: 0, matched: 0, unmatched: [], detected: detectedWithSets });
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

    const fittedSets = fitImportedSetsToCount(importedSets, setCount);
    setSelected(new Set(matchedIds));
    setHolidayOverrideIds(new Set());
    setSets(matchedIds.length > 0 ? fittedSets : null);
    setImportSummary({ total: imported.length, matched: matchedIds.length, unmatched, detected: detectedWithSets });
    setMsg(`Imported ${matchedIds.length} of ${imported.length} songs from ${file.name} in file order using ${setCount} set${setCount === 1 ? "" : "s"}. Review the detected setup, then save or adjust it.`);
  }

  async function addUnmatchedSong(importedSong: ImportedSong) {
    const key = `${importedSong.setIndex}-${importedSong.importIndex}-${importedSong.title}-${importedSong.artist}`;
    setAddingImportKey(key);
    setMsg(null);
    setSetAnalysis(null);

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

    const importStatus = (created as Song & { importStatus?: string }).importStatus;
    setSongs((current) => {
      const withoutExisting = current.filter((song) => song.id !== created.id);
      return [...withoutExisting, created].sort((a, b) => a.title.localeCompare(b.title));
    });
    setSelected((current) => new Set([...current, created.id]));
    if (isHolidayGenre(created.genre)) setHolidayOverrideIds((current) => new Set([...current, created.id]));
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
    setMsg(`${importStatus === "created" ? "Added" : "Reused"} ${created.title} ${importStatus === "updated" ? "and filled missing metadata " : ""}for Set ${Math.min(importedSong.setIndex, clampSetCount(numSets))}.`);
  }
  async function build() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/build-sets", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songIds: Array.from(selected),
        numSets,
        venueId: venueId || undefined,
        bandId: bandId || undefined,
        performedAt,
        allowHolidaySongIds: Array.from(holidayOverrideIds).filter((id) => selected.has(id)),
        strategy,
        eventType,
        avoidSameArtist,
        avoidSameGenre,
        avoidBigBpmDrops,
        avoidHardVocals,
        saveStrongestForLater,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    const data = await readObjectResponse<{ sets?: Built[]; explainability?: SetAnalysis }>(r, router, "Build sets");
    if (!Array.isArray(data?.sets)) {
      setMsg("Build response did not include sets.");
      return;
    }
    setImportSummary(null);
    setSets(data.sets);
    setSetAnalysis(data.explainability ?? null);
  }

  function reshuffle() {
    if (!sets) return;
    setSets(distributeSongs(shuffleSongs(sets.flatMap((set) => set.songs)), sets.length));
    setSetAnalysis(null);
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
    setSetAnalysis(null);
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
      cache: "no-store",
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
      {holidayOverridesOutsideSeason.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          This set includes Holiday songs outside the holiday season.
          <span className="ml-1 text-[var(--muted)]">{holidayOverridesOutsideSeason.map((song) => song.title).join(", ")}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card max-h-[520px] overflow-y-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-medium">Pool ({selected.size} selected)</h2>
            <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={selectAllSongs}>All</button>
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
            <label className="block text-sm text-[var(--muted)]">
              Build Set For
              <select className="input mt-1" value={eventType} onChange={(e) => {
                setEventType(e.target.value as SetBuildEventType);
                setSetAnalysis(null);
              }}>
                <option value="bar-crowd">Bar Crowd</option>
                <option value="brewery">Brewery</option>
                <option value="private-party">Private Party</option>
                <option value="wedding">Wedding</option>
                <option value="corporate-event">Corporate Event</option>
              </select>
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
                <div className="mt-2 space-y-2 text-xs text-[var(--muted)]">
                  <div>Matched {importSummary.matched} of {importSummary.total} imported songs.</div>
                  {importSummary.detected && (
                    <div className="grid gap-1 rounded-lg border border-[var(--border)] bg-[#0f131a]/60 px-3 py-2 sm:grid-cols-2">
                      <span>Detected band: <span className="text-[var(--text)]">{importSummary.detected.bandName ?? "No match"}</span></span>
                      <span>Detected venue: <span className="text-[var(--text)]">{importSummary.detected.venueName ?? "No match"}</span></span>
                      <span>Detected date: <span className="text-[var(--text)]">{importSummary.detected.performanceDate ? formatShortDate(importSummary.detected.performanceDate) : "No date"}</span></span>
                      <span>Detected sets: <span className="text-[var(--text)]">{importSummary.detected.setCount}</span></span>
                    </div>
                  )}
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
              {setAnalysis && <SetAnalysisPanel analysis={setAnalysis} />}
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
          performanceDate={performedAt}
          eventType={eventType}
          selectedIds={selected}
          onAddSong={(id) => {
            setSelected((current) => new Set([...current, id]));
            setSetAnalysis(null);
          }}
          onPickMany={(ids) => {
            setSelected(new Set(ids));
            setHolidayOverrideIds(new Set());
          }}
          onRows={updateReplacementPool}
        />
      )}
    </div>
  );
}

function Recommendations({
  venueId,
  bandId,
  performanceDate,
  eventType,
  selectedIds,
  onAddSong,
  onPickMany,
  onRows,
}: {
  venueId: string;
  bandId: string;
  performanceDate: string;
  eventType: SetBuildEventType;
  selectedIds: Set<string>;
  onAddSong: (id: string) => void;
  onPickMany: (ids: string[]) => void;
  onRows: (rows: BuiltSong[]) => void;
}) {
  type RecommendationRow = {
    id: string;
    title: string;
    artist: string;
    bpm: number | null;
    durationSec: number | null;
    recentPlaysAtVenue: number;
    recommendationScore: number;
    fitLabel: string;
    reasons: string[];
    topFactors: string[];
    scoringDetails: Array<{ label: string; value: string | number }>;
  };
  type ExcludedRecommendation = {
    id: string;
    title: string;
    artist: string;
    recommendationScore: number;
    fitLabel: string;
    reasons: string[];
    scoringDetails: Array<{ label: string; value: string | number }>;
  };
  type ReplacementPrompt = { songId: string; mode: "choices" | "list" };

  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [excluded, setExcluded] = useState<ExcludedRecommendation[]>([]);
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
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
      const r = await fetch(`/api/recommendations?venueId=${encodeURIComponent(venueId)}&bandId=${encodeURIComponent(bandId)}&performanceDate=${encodeURIComponent(performanceDate)}&eventType=${encodeURIComponent(eventType)}&seed=${seed}`, { cache: "no-store" });
      const data = await readObjectResponse<{ ranked?: unknown; excluded?: unknown }>(r, router, "Recommendations").catch((error) => {
        if (!cancelled) setMsg(error instanceof Error ? error.message : "Failed to load recommendations.");
        return null;
      });
      if (!cancelled && Array.isArray(data?.ranked)) {
        setRows(data.ranked as RecommendationRow[]);
        setExcluded(Array.isArray(data.excluded) ? data.excluded as ExcludedRecommendation[] : []);
        setIgnoredIds(new Set());
        setReplaceCursor(0);
        setReplacementPrompt(null);
        publishRows(data.ranked as RecommendationRow[]);
      }
    })();
    return () => { cancelled = true; };
  }, [bandId, eventType, performanceDate, publishRows, router, venueId]);

  if (rows.length === 0 && !msg) return null;
  const activeRows = rows.filter((row) => !ignoredIds.has(row.id));

  const targetSeconds = Math.max(0, Number(targetHours) || 0) * 3600;
  const bufferSeconds = Math.max(0, Number(bufferMinutes) || 0) * 60;
  const pickedForDuration: string[] = [];
  let pickedSongSeconds = 0;
  let pickedBufferSeconds = 0;
  for (const row of activeRows) {
    if (targetSeconds > 0 && pickedSongSeconds + pickedBufferSeconds >= targetSeconds) break;
    pickedForDuration.push(row.id);
    pickedSongSeconds += row.durationSec ?? 0;
    if (pickedForDuration.length > 1) pickedBufferSeconds += bufferSeconds;
  }
  const pickedSeconds = pickedSongSeconds + pickedBufferSeconds;
  const previewLimit = Math.max(25, pickedForDuration.length);
  const previewRows = activeRows.slice(0, previewLimit);

  function publishActiveRows(nextRows: RecommendationRow[], nextIgnoredIds = ignoredIds) {
    publishRows(nextRows.filter((row) => !nextIgnoredIds.has(row.id)));
  }

  function addSong(row: RecommendationRow) {
    onAddSong(row.id);
    const nextIgnored = new Set([...ignoredIds, row.id]);
    setIgnoredIds(nextIgnored);
    publishActiveRows(rows, nextIgnored);
  }

  function ignoreSong(row: RecommendationRow) {
    const nextIgnored = new Set([...ignoredIds, row.id]);
    setIgnoredIds(nextIgnored);
    publishActiveRows(rows, nextIgnored);
  }

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
    publishActiveRows(nextRows);
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
    publishActiveRows(nextRows);
  }

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Venue-Aware Recommendations</h2>
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
        Ranked for the selected Build Set For profile, venue history, band, performance date, and song metadata. Showing {previewRows.length} picks. Selected time includes {formatDuration(pickedSongSeconds)} of songs plus {formatDuration(pickedBufferSeconds)} of between-song buffer.
      </p>
      {msg && <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{msg}</div>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {previewRows.map((r) => {
          const promptIsOpen = replacementPrompt?.songId === r.id;
          const promptIsList = promptIsOpen && replacementPrompt.mode === "list";
          return (
            <li key={r.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  {r.title} <span className="text-[var(--muted)]">- {r.artist}</span>
                  <div className="mono mt-1 text-xs text-[var(--muted)]">{r.fitLabel}: {r.recommendationScore.toFixed(1)}/10 · recent plays: {r.recentPlaysAtVenue} {r.durationSec != null && `- ${formatDuration(r.durationSec)}`}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    <div className="font-medium text-[var(--text)]">Why recommended:</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {(r.topFactors.length > 0 ? r.topFactors : r.reasons).slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn btn-primary px-2 py-1 text-xs" disabled={selectedIds.has(r.id)} onClick={() => addSong(r)}>
                    {selectedIds.has(r.id) ? "Added" : "Add Song"}
                  </button>
                  <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => ignoreSong(r)}>Ignore Song</button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1 text-xs"
                    onClick={() => setReplacementPrompt(promptIsOpen ? null : { songId: r.id, mode: "choices" })}
                  >
                    Replace
                  </button>
                </div>
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
              <ScoringDetails label={r.fitLabel} details={r.scoringDetails} />
            </li>
          );
        })}
      </ul>
      {excluded.length > 0 && (
        <details className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
          <summary className="cursor-pointer text-amber-100">Excluded songs ({excluded.length})</summary>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            {excluded.map((song) => (
              <li key={song.id} className="rounded-md border border-[var(--border)] px-2 py-2">
                <div className="font-medium text-[var(--text)]">{song.title} <span className="font-normal text-[var(--muted)]">- {song.artist}</span></div>
                <div className="mono mt-1 text-[var(--muted)]">{song.fitLabel}: {song.recommendationScore.toFixed(1)}/10</div>
                <div className="mt-2 text-amber-100">Not recommended because:</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {song.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                <ScoringDetails label={song.fitLabel} details={song.scoringDetails} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ScoringDetails({ label, details }: { label: string; details: Array<{ label: string; value: string | number }> }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-[var(--accent)]">View scoring details</summary>
      <div className="mt-2 rounded-md border border-[var(--border)] px-2 py-2">
        <div className="mb-1 font-medium text-[var(--text)]">{label} Score:</div>
        <ul className="list-disc space-y-0.5 pl-4 text-[var(--muted)]">
          {details.map((detail) => (
            <li key={detail.label}>
              {detail.label}: <span className="text-[var(--text)]">{detail.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}








