"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readArrayResponse } from "@/app/client-fetch";

type Song = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  musicalKey: string | null;
  durationSec: number | null;
  energy: number | null;
  notes: string | null;
  genre: string | null;
  vibe: string | null;
  crowdScore: number | null;
  danceability: number | null;
  vocalDifficulty: number | null;
  openerCandidate: boolean | null;
  closerCandidate: boolean | null;
  leadSinger: string | null;
  capoOrTuning: string | null;
  avoidAfter: string | null;
};

type SongForm = {
  title: string;
  artist: string;
  bpm: string;
  musicalKey: string;
  durationSec: string;
  energy: string;
  notes: string;
  genre: string;
  vibe: string;
  crowdScore: string;
  danceability: string;
  vocalDifficulty: string;
  openerCandidate: boolean;
  closerCandidate: boolean;
  leadSinger: string;
  capoOrTuning: string;
  avoidAfter: string;
};

type EditForm = SongForm;

type LookupResult = {
  updated: Song | null;
  message: string | null;
};

type MetadataLookupResult = {
  source: "musicbrainz" | "musicbrainz-lastfm" | "lastfm" | "none";
  musicBrainzRecordingId?: string;
  lastfmUrl?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  durationSec: number | null;
  crowdScore: number | null;
  genre: string | null;
  vibe: string | null;
  message?: string;
};

type SmartLookupPreview = {
  songId: string;
  result: MetadataLookupResult;
};

const emptyForm: SongForm = {
  title: "",
  artist: "",
  bpm: "",
  musicalKey: "",
  durationSec: "",
  energy: "",
  notes: "",
  genre: "",
  vibe: "",
  crowdScore: "",
  danceability: "",
  vocalDifficulty: "",
  openerCandidate: false,
  closerCandidate: false,
  leadSinger: "",
  capoOrTuning: "",
  avoidAfter: "",
};

function formatDuration(seconds: number | null) {
  if (seconds == null) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function parseDuration(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes(":")) {
    const [minutes, seconds] = trimmed.split(":");
    const mins = Number(minutes);
    const secs = Number(seconds);
    if (!Number.isInteger(mins) || !Number.isInteger(secs) || mins < 0 || secs < 0 || secs > 59) return NaN;
    return mins * 60 + secs;
  }

  const mins = Number(trimmed);
  if (!Number.isFinite(mins) || mins <= 0) return NaN;
  return Math.round(mins * 60);
}

function parseBpm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const bpm = Number(trimmed);
  if (!Number.isInteger(bpm) || bpm <= 0 || bpm > 400) return NaN;
  return bpm;
}

function parseRating(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const rating = Number(trimmed);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) return NaN;
  return rating / 10;
}

function formatRating(value: number | null) {
  if (value == null) return "";
  const normalized = value > 1 ? value / 10 : value;
  return Math.round(normalized * 10).toString();
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

function editFormFromSong(song: Song): EditForm {
  return {
    title: song.title,
    artist: song.artist,
    bpm: song.bpm?.toString() ?? "",
    musicalKey: song.musicalKey ?? "",
    durationSec: song.durationSec == null ? "" : formatDuration(song.durationSec),
    energy: formatRating(song.energy),
    notes: song.notes ?? "",
    genre: song.genre ?? "",
    vibe: song.vibe ?? "",
    crowdScore: formatRating(song.crowdScore),
    danceability: formatRating(song.danceability),
    vocalDifficulty: formatRating(song.vocalDifficulty),
    openerCandidate: Boolean(song.openerCandidate),
    closerCandidate: Boolean(song.closerCandidate),
    leadSinger: song.leadSinger ?? "",
    capoOrTuning: song.capoOrTuning ?? "",
    avoidAfter: song.avoidAfter ?? "",
  };
}

function duplicateKey(song: Song) {
  return `${song.title} ${song.artist}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataBody(form: SongForm) {
  return {
    notes: form.notes.trim() || null,
    musicalKey: form.musicalKey.trim() || null,
    energy: parseRating(form.energy),
    genre: form.genre.trim() || null,
    vibe: form.vibe.trim() || null,
    crowdScore: parseRating(form.crowdScore),
    danceability: parseRating(form.danceability),
    vocalDifficulty: parseRating(form.vocalDifficulty),
    openerCandidate: form.openerCandidate,
    closerCandidate: form.closerCandidate,
    leadSinger: form.leadSinger.trim() || null,
    capoOrTuning: form.capoOrTuning.trim() || null,
    avoidAfter: form.avoidAfter.trim() || null,
  };
}

function smartSummary(song: Song) {
  const ratingParts = [
    song.energy != null ? `E${formatRating(song.energy)}` : null,
    song.crowdScore != null ? `C${formatRating(song.crowdScore)}` : null,
    song.danceability != null ? `D${formatRating(song.danceability)}` : null,
    song.vocalDifficulty != null ? `V${formatRating(song.vocalDifficulty)}` : null,
  ].filter(Boolean);
  const contextParts = [
    song.genre ? `G:${song.genre}` : null,
    song.vibe ? `Vibe:${song.vibe}` : null,
    song.leadSinger ? `Singer:${song.leadSinger}` : null,
    song.capoOrTuning ? `Tune:${song.capoOrTuning}` : null,
    song.openerCandidate ? "Opener" : null,
    song.closerCandidate ? "Closer" : null,
    song.avoidAfter ? "Avoids" : null,
  ].filter(Boolean);

  const metadataCount = ratingParts.length + contextParts.length;
  if (metadataCount === 0) return "Missing";

  const hasCoreRatings = song.energy != null && song.crowdScore != null && song.danceability != null && song.vocalDifficulty != null;
  const status = hasCoreRatings ? "Ready" : "Partial";
  return [status, ratingParts.join(" "), contextParts.slice(0, 2).join(" ")].filter(Boolean).join(" - ");
}

function MetadataField({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1 text-xs text-[var(--muted)]" title={helper}>
      <span className="font-medium text-[var(--text)]">{label}</span>
      {children}
      {helper && <span className="block leading-snug text-[11px] text-[var(--muted)]">{helper}</span>}
    </div>
  );
}

function RatingPresets({
  value,
  onPick,
  hardLabels = false,
}: {
  value: string;
  onPick: (value: string) => void;
  hardLabels?: boolean;
}) {
  const presets = hardLabels
    ? [
        ["Easy", "3"],
        ["Medium", "6"],
        ["Hard", "9"],
      ]
    : [
        ["Low", "3"],
        ["Medium", "6"],
        ["High", "9"],
      ];
  const selected = Number(value);

  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map(([label, presetValue]) => {
        const isSelected = selected === Number(presetValue);
        return (
          <button
            key={presetValue}
            type="button"
            className={`btn px-2 py-1 text-[11px] ${isSelected ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={isSelected}
            onClick={() => onPick(presetValue)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function OptionalMetadata({ form, onChange, defaultOpen = false }: { form: SongForm; onChange: (patch: Partial<SongForm>) => void; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-[var(--border)] bg-[#0f131a]/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">Optional smart builder metadata</summary>
      <div className="mt-3 space-y-4">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Audience and energy</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetadataField label="Energy Level (1-10)" helper="How intense or high-energy the song feels live">
              <input className="input" type="number" min="1" max="10" step="1" value={form.energy} onChange={(e) => onChange({ energy: e.target.value })} />
              <RatingPresets value={form.energy} onPick={(value) => onChange({ energy: value })} />
            </MetadataField>
            <MetadataField label="Crowd Familiarity (1-10)" helper="How likely the audience knows this song">
              <input className="input" type="number" min="1" max="10" step="1" value={form.crowdScore} onChange={(e) => onChange({ crowdScore: e.target.value })} />
              <RatingPresets value={form.crowdScore} onPick={(value) => onChange({ crowdScore: value })} />
            </MetadataField>
            <MetadataField label="Danceability (1-10)" helper="How likely people are to dance">
              <input className="input" type="number" min="1" max="10" step="1" value={form.danceability} onChange={(e) => onChange({ danceability: e.target.value })} />
              <RatingPresets value={form.danceability} onPick={(value) => onChange({ danceability: value })} />
            </MetadataField>
            <MetadataField label="Vocal Difficulty (1-10)" helper="How demanding the vocals are">
              <input className="input" type="number" min="1" max="10" step="1" value={form.vocalDifficulty} onChange={(e) => onChange({ vocalDifficulty: e.target.value })} />
              <RatingPresets value={form.vocalDifficulty} hardLabels onPick={(value) => onChange({ vocalDifficulty: value })} />
            </MetadataField>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Style and feel</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetadataField label="Genre">
              <input className="input" placeholder="Rock, pop, country..." value={form.genre} onChange={(e) => onChange({ genre: e.target.value })} />
            </MetadataField>
            <MetadataField label="Vibe / Mood">
              <input className="input" placeholder="Chill, rowdy, singalong..." value={form.vibe} onChange={(e) => onChange({ vibe: e.target.value })} />
            </MetadataField>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Performance notes</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetadataField label="Lead Singer">
              <input className="input" placeholder="Singer name" value={form.leadSinger} onChange={(e) => onChange({ leadSinger: e.target.value })} />
            </MetadataField>
            <MetadataField label="Capo or Alternate Tuning">
              <input className="input" placeholder="Capo 2, Eb tuning..." value={form.capoOrTuning} onChange={(e) => onChange({ capoOrTuning: e.target.value })} />
            </MetadataField>
            <MetadataField label="Avoid Playing After" helper="Songs, artists, genres, or vibes that transition poorly into this song">
              <input className="input" placeholder="Comma-separated songs, artists, genres, or vibes" value={form.avoidAfter} onChange={(e) => onChange({ avoidAfter: e.target.value })} />
            </MetadataField>
            <div className="flex flex-wrap items-center gap-3 self-end rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.openerCandidate} onChange={(e) => onChange({ openerCandidate: e.target.checked })} />
                Opener candidate
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.closerCandidate} onChange={(e) => onChange({ closerCandidate: e.target.checked })} />
                Closer candidate
              </label>
            </div>
          </div>
        </section>
      </div>
    </details>
  );
}

export default function SongsPage() {
  const router = useRouter();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<SongForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyForm);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [smartBusyId, setSmartBusyId] = useState<string | null>(null);
  const [smartPreview, setSmartPreview] = useState<SmartLookupPreview | null>(null);
  const [smartStatusById, setSmartStatusById] = useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const song of songs) {
      const key = duplicateKey(song);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [songs]);

  const duplicateSongIds = useMemo(
    () => new Set(songs.filter((song) => (duplicateCounts.get(duplicateKey(song)) ?? 0) > 1).map((song) => song.id)),
    [duplicateCounts, songs],
  );
  const shouldShowDuplicatesOnly = showDuplicatesOnly && duplicateSongIds.size > 0;
  const visibleSongs = shouldShowDuplicatesOnly ? songs.filter((song) => duplicateSongIds.has(song.id)) : songs;
  const duplicateGroupCount = new Set(
    songs.map((song) => duplicateKey(song)).filter((key) => (duplicateCounts.get(key) ?? 0) > 1),
  ).size;
  const missingBpmCount = songs.filter((song) => song.bpm == null).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/songs");
      setSongs(await readArrayResponse<Song>(r, router, "Songs"));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed to load songs.");
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  function validateSmartScores(current: SongForm) {
    for (const [label, value] of [
      ["Energy", current.energy],
      ["Crowd score", current.crowdScore],
      ["Danceability", current.danceability],
      ["Vocal difficulty", current.vocalDifficulty],
    ]) {
      if (Number.isNaN(parseRating(value))) return `${label} must be a whole number from 1 to 10.`;
    }
    return null;
  }

  async function addSong(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const scoreError = validateSmartScores(form);
    if (scoreError) {
      setMsg(scoreError);
      return;
    }
    const body: Record<string, unknown> = {
      title: form.title,
      artist: form.artist,
      ...metadataBody(form),
    };
    const bpm = parseBpm(form.bpm);
    if (Number.isNaN(bpm)) {
      setMsg("Enter BPM as a whole number between 1 and 400.");
      return;
    }
    if (bpm != null) body.bpm = bpm;
    const durationSec = parseDuration(form.durationSec);
    if (Number.isNaN(durationSec)) {
      setMsg("Enter duration as minutes or m:ss, like 4 or 3:45.");
      return;
    }
    if (durationSec != null) body.durationSec = durationSec;
    const r = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }
    setForm(emptyForm);
    await load();
  }

  async function importCsv(file: File | null) {
    if (!file) return;
    setCsvBusy(true);
    setMsg(null);
    const text = await file.text();
    const r = await fetch("/api/import/csv", { method: "POST", body: text });
    const data = await r.json();
    setCsvBusy(false);
    if (!r.ok) setMsg(data.error?.join?.() ?? JSON.stringify(data));
    else setMsg(`Imported ${data.imported} rows`);
    await load();
  }

  async function lookupAndSaveBpm(song: Song): Promise<LookupResult> {
    const r = await fetch("/api/bpm-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: song.title, artist: song.artist }),
    });

    if (!r.ok) return { updated: null, message: await readErrorMessage(r) };

    const data = await r.json();
    if (data.message && !data.bpm) return { updated: null, message: data.message };

    const patch = await fetch(`/api/songs/${song.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bpm: data.bpm,
        energy: data.energy,
        musicalKey: data.musicalKey ?? song.musicalKey,
        durationSec: data.durationSec ?? song.durationSec,
      }),
    });

    if (!patch.ok) return { updated: null, message: await readErrorMessage(patch) };
    return { updated: (await patch.json()) as Song, message: null };
  }

  async function lookupBpm(song: Song) {
    setMsg(null);
    setSavingId(song.id);
    const result = await lookupAndSaveBpm(song);
    setSavingId(null);

    if (!result.updated) {
      setMsg(result.message ?? "No BPM found. You can add it manually with Edit.");
      return;
    }

    setSongs((current) => current.map((row) => (row.id === result.updated?.id ? result.updated : row)));
    setMsg(`Updated BPM for ${result.updated.title}.`);
  }
  function lookupIdentity(song: Song) {
    if (editingId !== song.id) return { title: song.title, artist: song.artist };
    return {
      title: editForm.title.trim() || song.title,
      artist: editForm.artist.trim() || song.artist,
    };
  }

  function setSmartStatus(songId: string, message: string | null) {
    setSmartStatusById((current) => {
      const next = { ...current };
      if (message) next[songId] = message;
      else delete next[songId];
      return next;
    });
  }

  function applySmartResultToEditForm(result: MetadataLookupResult) {
    setEditForm((current) => ({
      ...current,
      durationSec: result.durationSec != null ? formatDuration(result.durationSec) : current.durationSec,
      crowdScore: result.crowdScore != null ? result.crowdScore.toString() : current.crowdScore,
      genre: result.genre ?? current.genre,
      vibe: result.vibe ?? current.vibe,
    }));
  }

  async function lookupSmartData(song: Song) {
    const identity = lookupIdentity(song);
    setMsg(null);
    setSmartPreview(null);
    setSmartStatus(song.id, `Looking up metadata for ${identity.title} - ${identity.artist}...`);
    setSmartBusyId(song.id);

    let response: Response;
    let data: MetadataLookupResult | { error?: unknown; message?: string } | null = null;
    try {
      response = await fetch("/api/metadata/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      });
      data = (await response.json().catch(() => null)) as MetadataLookupResult | { error?: unknown; message?: string } | null;
      console.debug("Metadata lookup", { status: response.status, title: identity.title, artist: identity.artist, response: data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metadata lookup failed.";
      setSmartBusyId(null);
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    setSmartBusyId(null);

    if (!data || !("source" in data)) {
      const message = data?.message ? `Metadata lookup failed (${response.status}): ${data.message}` : `Metadata lookup failed (${response.status}).`;
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    if (!response.ok || data.source === "none") {
      const message = data.message ? `Metadata lookup failed (${response.status}): ${data.message}` : `Metadata lookup failed (${response.status}).`;
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    const matchedMessage = `Matched ${data.matchedTitle ?? identity.title} by ${data.matchedArtist ?? identity.artist}.`;
    if (editingId === song.id) {
      applySmartResultToEditForm(data);
      const message = `${matchedMessage} Filled available edit fields. Review, then click Save.`;
      setSmartStatus(song.id, data.message ? `${message} ${data.message}` : message);
      setMsg(data.message ?? message);
      return;
    }

    setSmartPreview({ songId: song.id, result: data });
    setSmartStatus(song.id, data.message ? `${matchedMessage} ${data.message}` : `${matchedMessage} Review and apply the metadata.`);
    setMsg(data.message ?? `${matchedMessage} Review and apply the metadata.`);
  }

  async function applySmartData(song: Song, result: MetadataLookupResult) {
    const body: Record<string, unknown> = {};
    if (result.durationSec != null) body.durationSec = result.durationSec;
    if (result.crowdScore != null) body.crowdScore = result.crowdScore;
    if (result.genre) body.genre = result.genre;
    if (result.vibe) body.vibe = result.vibe;

    if (Object.keys(body).length === 0) {
      setMsg(result.message ?? "Metadata lookup did not return anything to apply.");
      return;
    }

    setSavingId(song.id);
    const response = await fetch(`/api/songs/${song.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSavingId(null);

    if (!response.ok) {
      setMsg(await readErrorMessage(response));
      return;
    }

    const updated = (await response.json()) as Song;
    setSongs((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    if (editingId === updated.id) setEditForm(editFormFromSong(updated));
    setSmartPreview(null);
    setSmartStatus(song.id, result.message ?? `Applied metadata for ${updated.title}.`);
    setMsg(result.message ?? `Applied metadata for ${updated.title}.`);
  }

  async function lookupMissingBpms() {
    const targets = songs.filter((song) => song.bpm == null);
    if (targets.length === 0) {
      setMsg("All songs already have BPM values.");
      return;
    }

    setMsg(null);
    setBulkBusy(true);
    let updatedCount = 0;
    const misses: string[] = [];

    for (const [index, song] of targets.entries()) {
      setMsg(`Looking up BPMs ${index + 1}/${targets.length}: ${song.title}`);
      const result = await lookupAndSaveBpm(song);

      if (result.updated) {
        updatedCount += 1;
        setSongs((current) => current.map((row) => (row.id === result.updated?.id ? result.updated : row)));
      } else {
        misses.push(song.title);
      }
    }

    setBulkBusy(false);
    setMsg(
      misses.length > 0
        ? `Updated ${updatedCount} BPM${updatedCount === 1 ? "" : "s"}. ${misses.length} still need manual BPM entry.`
        : `Updated ${updatedCount} BPM${updatedCount === 1 ? "" : "s"}.`,
    );
  }

  function startEdit(song: Song) {
    setMsg(null);
    setEditingId(song.id);
    setEditForm(editFormFromSong(song));
  }

  async function saveEdit(song: Song) {
    setMsg(null);
    const title = editForm.title.trim();
    const artist = editForm.artist.trim();
    if (!title || !artist) {
      setMsg("Title and artist are required.");
      return;
    }

    const scoreError = validateSmartScores(editForm);
    if (scoreError) {
      setMsg(scoreError);
      return;
    }

    const bpm = parseBpm(editForm.bpm);
    if (Number.isNaN(bpm)) {
      setMsg("Enter BPM as a whole number between 1 and 400.");
      return;
    }

    const durationSec = parseDuration(editForm.durationSec);
    if (Number.isNaN(durationSec)) {
      setMsg("Enter duration as minutes or m:ss, like 4 or 3:45.");
      return;
    }

    setSavingId(song.id);
    const r = await fetch(`/api/songs/${song.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, artist, bpm, durationSec, ...metadataBody(editForm) }),
    });
    setSavingId(null);

    if (!r.ok) {
      setMsg(await readErrorMessage(r));
      return;
    }

    const updated = (await r.json()) as Song;
    setSongs((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setEditingId(null);
  }

  async function remove(id: string) {
    if (!confirm("Delete this song?")) return;
    await fetch(`/api/songs/${id}`, { method: "DELETE" });
    setSongs((current) => current.filter((song) => song.id !== id));
    setEditingId((current) => (current === id ? null : current));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Songs</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          CSV columns: title, artist, bpm, key, duration_sec, energy, notes, genre, vibe, crowd_score, danceability, vocal_difficulty, opener_candidate, closer_candidate, lead_singer, capo_or_tuning, avoid_after.
        </p>
      </div>

      {msg && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{msg}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={addSong} className="card space-y-3">
          <h2 className="font-medium">Add song</h2>
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          <input className="input" placeholder="Artist" value={form.artist} onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))} required />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="BPM" value={form.bpm} onChange={(e) => setForm((f) => ({ ...f, bpm: e.target.value }))} />
            <input className="input" placeholder="Key" value={form.musicalKey} onChange={(e) => setForm((f) => ({ ...f, musicalKey: e.target.value }))} />
          </div>
          <input className="input" placeholder="Duration (m:ss)" value={form.durationSec} onChange={(e) => setForm((f) => ({ ...f, durationSec: e.target.value }))} />
          <textarea className="input min-h-[72px]" placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          <OptionalMetadata form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          <button type="submit" className="btn btn-primary w-full">Save song</button>
        </form>

        <div className="card space-y-3">
          <h2 className="font-medium">Import CSV</h2>
          <input type="file" accept=".csv,text/csv" disabled={csvBusy} onChange={(e) => void importCsv(e.target.files?.[0] ?? null)} className="text-sm text-[var(--muted)]" />
          <p className="text-xs text-[var(--muted)]">Old CSV files still work. New smart builder columns are optional.</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Library ({loading ? "..." : songs.length})</h2>
            {duplicateSongIds.size > 0 && (
              <p className="mt-1 text-xs text-amber-200">
                {duplicateSongIds.size} duplicate songs across {duplicateGroupCount} duplicate group{duplicateGroupCount === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={loading || (!showDuplicatesOnly && duplicateSongIds.size === 0)} onClick={() => setShowDuplicatesOnly((value) => !value)}>
              {shouldShowDuplicatesOnly ? "Show all songs" : `Show duplicates (${duplicateSongIds.size})`}
            </button>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={loading || bulkBusy || missingBpmCount === 0} onClick={() => void lookupMissingBpms()}>
              {bulkBusy ? "Looking up BPMs" : `Lookup missing BPMs (${missingBpmCount})`}
            </button>
          </div>
        </div>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="pb-2 pr-2">Title</th>
              <th className="pb-2 pr-2">Artist</th>
              <th className="pb-2 pr-2">BPM</th>
              <th className="pb-2 pr-2">Key</th>
              <th className="pb-2 pr-2">Dur</th>
              <th className="pb-2 pr-2">Smart</th>
              <th className="pb-2"> </th>
            </tr>
          </thead>
          <tbody className="mono text-xs">{visibleSongs.flatMap((s) => {
              const isEditing = editingId === s.id;
              const isDuplicate = duplicateSongIds.has(s.id);
              const rows = [
                <tr key={`${s.id}-main`} className={`border-t border-[var(--border)] ${isDuplicate ? "bg-amber-500/5" : ""}`}>
                  <td className="py-2 pr-2 align-top">
                    {isEditing ? (
                      <input className="input min-w-40 px-2 py-1 text-xs" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
                    ) : (
                      <>
                        {s.title}
                        {isDuplicate && <span className="ml-2 rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-200">Duplicate</span>}
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    {isEditing ? (
                      <input className="input min-w-36 px-2 py-1 text-xs" value={editForm.artist} onChange={(e) => setEditForm((f) => ({ ...f, artist: e.target.value }))} />
                    ) : (
                      s.artist
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    {isEditing ? (
                      <input className="input w-20 px-2 py-1 text-xs" inputMode="numeric" placeholder="BPM" value={editForm.bpm} onChange={(e) => setEditForm((f) => ({ ...f, bpm: e.target.value }))} />
                    ) : (
                      (s.bpm ?? "-")
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    {isEditing ? (
                      <input className="input w-24 px-2 py-1 text-xs" placeholder="Key" value={editForm.musicalKey} onChange={(e) => setEditForm((f) => ({ ...f, musicalKey: e.target.value }))} />
                    ) : (
                      (s.musicalKey ?? "-")
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    {isEditing ? (
                      <input className="input w-24 px-2 py-1 text-xs" placeholder="m:ss" value={editForm.durationSec} onChange={(e) => setEditForm((f) => ({ ...f, durationSec: e.target.value }))} />
                    ) : (
                      formatDuration(s.durationSec)
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    <span className="block max-w-[420px] whitespace-normal text-[var(--muted)]">
                      {isEditing ? "Editing smart metadata below" : smartSummary(s)}
                    </span>
                  </td>
                  <td className="py-2 text-right align-top">
                    {isEditing ? (
                      <>
                        <button type="button" className="btn btn-primary mr-2 px-2 py-1 text-xs" disabled={savingId === s.id} onClick={() => void saveEdit(s)}>{savingId === s.id ? "Saving" : "Save"}</button>
                        <button type="button" className="btn btn-ghost mr-2 px-2 py-1 text-xs" disabled={smartBusyId === s.id || savingId === s.id} onClick={() => void lookupSmartData(s)}>{smartBusyId === s.id ? "Looking up..." : "Lookup Metadata"}</button>
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-ghost mr-2 px-2 py-1 text-xs" onClick={() => startEdit(s)}>Edit</button>
                        <button type="button" className="btn btn-ghost mr-2 px-2 py-1 text-xs" disabled={bulkBusy || savingId === s.id} onClick={() => void lookupBpm(s)}>{savingId === s.id ? "Looking" : "Lookup BPM"}</button>
                        <button type="button" className="btn btn-ghost mr-2 px-2 py-1 text-xs" disabled={bulkBusy || smartBusyId === s.id || savingId === s.id} onClick={() => void lookupSmartData(s)}>{smartBusyId === s.id ? "Looking up..." : "Lookup Metadata"}</button>
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs text-rose-300" onClick={() => void remove(s.id)}>Del</button>
                      </>
                    )}
                  </td>
                </tr>,
              ];

              if (smartStatusById[s.id]) {
                rows.push(
                  <tr key={`${s.id}-smart-status`} className="border-t border-[var(--border)] bg-[#10151e]">
                    <td colSpan={7} className="px-3 py-2">
                      <div className="mx-auto max-w-5xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                        {smartStatusById[s.id]}
                      </div>
                    </td>
                  </tr>,
                );
              }

              if (isEditing) {
                rows.push(
                  <tr key={`${s.id}-edit-panel`} className="border-t border-[var(--border)] bg-[#0f131a]">
                    <td colSpan={7} className="px-3 py-4">
                      <div className="mx-auto max-w-5xl space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                          <span className="text-[var(--muted)]">Use the current title and artist in this edit row for MusicBrainz and Last.fm metadata lookup.</span>
                          <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={smartBusyId === s.id || savingId === s.id} onClick={() => void lookupSmartData(s)}>
                            {smartBusyId === s.id ? "Looking up..." : "Lookup Metadata"}
                          </button>
                        </div>
                        <OptionalMetadata form={editForm} defaultOpen onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />
                      </div>
                    </td>
                  </tr>,
                );
              }

              if (smartPreview?.songId === s.id) {
                rows.push(
                  <tr key={`${s.id}-smart-preview`} className="border-t border-[var(--border)] bg-[#10151e]">
                    <td colSpan={7} className="px-3 py-4">
                      <div className="mx-auto max-w-5xl rounded-lg border border-[var(--border)] px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-medium text-[var(--accent)]">Metadata lookup match</h3>
                            <p className="mt-1 text-[var(--muted)]">
                              {smartPreview.result.matchedTitle ?? s.title} - {smartPreview.result.matchedArtist ?? s.artist}
                            </p>
                            {smartPreview.result.message && <p className="mt-1 text-xs text-amber-200">{smartPreview.result.message}</p>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={savingId === s.id} onClick={() => void applySmartData(s, smartPreview.result)}>
                              {savingId === s.id ? "Applying" : "Apply metadata"}
                            </button>
                            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setSmartPreview(null)}>Cancel</button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2 lg:grid-cols-4">
                          <span>Duration: {smartPreview.result.durationSec != null ? formatDuration(smartPreview.result.durationSec) : "unchanged"}</span>
                          <span>Popularity/Crowd: {smartPreview.result.crowdScore != null ? `${smartPreview.result.crowdScore}/10` : "unchanged"}</span>
                          <span>Genre: {smartPreview.result.genre ?? "unchanged"}</span>
                          <span>Vibe: {smartPreview.result.vibe ?? "unchanged"}</span>
                          <span>Source: {smartPreview.result.source}</span>
                        </div>
                      </div>
                    </td>
                  </tr>,
                );
              }

              return rows;
            })}</tbody>
        </table>
        {shouldShowDuplicatesOnly && visibleSongs.length === 0 && <div className="py-6 text-sm text-[var(--muted)]">No duplicate songs found.</div>}
      </div>
    </div>
  );
}





















