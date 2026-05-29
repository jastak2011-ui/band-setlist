"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  singalongScore: number | null;
  peakHourScore: number | null;
  transitionFlexibility: number | null;
  audienceAgeAppeal: string[] | null;
  femaleParticipationScore: number | null;
  singalongScoreSource: string | null;
  peakHourScoreSource: string | null;
  transitionFlexibilitySource: string | null;
  audienceAgeAppealSource: string | null;
  femaleParticipationScoreSource: string | null;
  openerCandidate: boolean | null;
  closerCandidate: boolean | null;
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
  singalongScore: string;
  peakHourScore: string;
  transitionFlexibility: string;
  audienceAgeAppeal: string[];
  femaleParticipationScore: string;
  openerCandidate: boolean;
  closerCandidate: boolean;
  capoOrTuning: string;
  avoidAfter: string;
};

type EditForm = SongForm;

type MetadataLookupResult = {
  source: "enrichment" | "none";
  musicBrainzRecordingId?: string;
  lastfmUrl?: string;
  deezerTrackId?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  sourcesTried: string[];
  proposals: EnrichmentProposal[];
  unavailable: EnrichmentProposal[];
  durationSec: number | null;
  bpm: number | null;
  energy: number | null;
  danceability: number | null;
  crowdScore: number | null;
  singalongScore: number | null;
  peakHourScore: number | null;
  transitionFlexibility: number | null;
  audienceAgeAppeal: string[] | null;
  femaleParticipationScore: number | null;
  genre: string | null;
  vibe: string | null;
  message?: string;
};

type EnrichmentField =
  | "title"
  | "artist"
  | "bpm"
  | "durationSec"
  | "genre"
  | "vibe"
  | "crowdScore"
  | "danceability"
  | "energy"
  | "vocalDifficulty"
  | "singalongScore"
  | "peakHourScore"
  | "transitionFlexibility"
  | "audienceAgeAppeal"
  | "femaleParticipationScore"
  | "openerCandidate"
  | "closerCandidate"
  | "musicalKey";

type EnrichmentProposal = {
  field: EnrichmentField;
  current: string | number | boolean | string[] | null;
  proposed: string | number | boolean | string[] | null;
  source: "local-library" | "deezer" | "musicbrainz" | "lastfm" | "lastfm-tags" | "none";
  status: "found" | "not-found";
  note?: string;
};

type SmartLookupPreview = {
  songId: string;
  result: MetadataLookupResult;
};

type BulkEnrichProgress = {
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
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
  singalongScore: "",
  peakHourScore: "",
  transitionFlexibility: "",
  audienceAgeAppeal: [],
  femaleParticipationScore: "",
  openerCandidate: false,
  closerCandidate: false,
  capoOrTuning: "",
  avoidAfter: "",
};

const csvImportTemplate = [
  "title,artist,key,capo,bpm,duration,genre,notes,vibe,crowd_score,danceability,vocal_difficulty,singalong_score,peak_hour_score,transition_flexibility,audience_age_appeal,female_participation_score,opener_candidate,closer_candidate,capo_or_tuning,avoid_after",
  "Example Song,Example Artist,G,,120,3:45,Rock,Notes,Upbeat,8,7,4,8,8,6,Gen X;Millennial;All Ages,8,true,false,,",
].join("\n");

const audienceAgeOptions = ["Boomer", "Gen X", "Millennial", "Gen Z", "All Ages"] as const;

const htmlImportTemplate = `<!doctype html>
<html>
  <body>
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Artist</th>
          <th>Key</th>
          <th>Capo</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Example Song</td>
          <td>Example Artist</td>
          <td>G</td>
          <td>2</td>
        </tr>
        <tr>
          <td>SET 2</td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;

const bulkEnrichmentFields: EnrichmentField[] = [
  "bpm",
  "durationSec",
  "genre",
  "vibe",
  "crowdScore",
  "danceability",
  "energy",
  "vocalDifficulty",
  "singalongScore",
  "peakHourScore",
  "transitionFlexibility",
  "audienceAgeAppeal",
  "femaleParticipationScore",
  "openerCandidate",
  "closerCandidate",
];

function formatDuration(seconds: number | null) {
  if (seconds == null) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function downloadTextTemplate(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function hasValue(value: unknown) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function formatPreviewValue(value: unknown) {
  if (!hasValue(value)) return "-";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 10));
  return String(value);
}

function enrichmentFieldLabel(field: EnrichmentField) {
  const labels: Record<EnrichmentField, string> = {
    title: "Title",
    artist: "Artist",
    bpm: "BPM",
    durationSec: "Duration",
    genre: "Genre",
    vibe: "Vibe",
    crowdScore: "Crowd",
    danceability: "Danceability",
    energy: "Energy",
    vocalDifficulty: "Vocal difficulty",
    singalongScore: "Singalong",
    peakHourScore: "Peak hour",
    transitionFlexibility: "Transition flexibility",
    audienceAgeAppeal: "Audience age appeal",
    femaleParticipationScore: "Female participation",
    openerCandidate: "Opener",
    closerCandidate: "Closer",
    musicalKey: "Key",
  };
  return labels[field];
}

function songValue(song: Song, field: EnrichmentField) {
  return song[field] ?? null;
}

function formValue(form: SongForm, field: EnrichmentField) {
  return form[field] ?? null;
}

function canFillMissing(current: unknown) {
  return !hasValue(current);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function songMatchesSearch(song: Song, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    song.title,
    song.artist,
    song.genre,
    song.musicalKey,
    song.notes,
  ].some((value) => (value ?? "").toLowerCase().includes(normalized));
}

function missingBulkEnrichmentFields(song: Song) {
  return bulkEnrichmentFields.filter((field) => canFillMissing(songValue(song, field)));
}

async function readErrorMessage(response: Response) {
  if (response.status === 401) return "You are not logged in or your session expired. Please log in again.";
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
    singalongScore: formatRating(song.singalongScore),
    peakHourScore: formatRating(song.peakHourScore),
    transitionFlexibility: formatRating(song.transitionFlexibility),
    audienceAgeAppeal: song.audienceAgeAppeal ?? [],
    femaleParticipationScore: formatRating(song.femaleParticipationScore),
    openerCandidate: Boolean(song.openerCandidate),
    closerCandidate: Boolean(song.closerCandidate),
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
    singalongScore: parseRating(form.singalongScore),
    peakHourScore: parseRating(form.peakHourScore),
    transitionFlexibility: parseRating(form.transitionFlexibility),
    audienceAgeAppeal: form.audienceAgeAppeal.length ? form.audienceAgeAppeal : null,
    femaleParticipationScore: parseRating(form.femaleParticipationScore),
    singalongScoreSource: form.singalongScore.trim() ? "manual" : null,
    peakHourScoreSource: form.peakHourScore.trim() ? "manual" : null,
    transitionFlexibilitySource: form.transitionFlexibility.trim() ? "manual" : null,
    audienceAgeAppealSource: form.audienceAgeAppeal.length ? "manual" : null,
    femaleParticipationScoreSource: form.femaleParticipationScore.trim() ? "manual" : null,
    openerCandidate: form.openerCandidate,
    closerCandidate: form.closerCandidate,
    capoOrTuning: form.capoOrTuning.trim() || null,
    avoidAfter: form.avoidAfter.trim() || null,
  };
}

function lookupPayloadFromSong(song: Song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    bpm: song.bpm,
    musicalKey: song.musicalKey,
    durationSec: song.durationSec,
    energy: song.energy,
    genre: song.genre,
    vibe: song.vibe,
    crowdScore: song.crowdScore,
    danceability: song.danceability,
    vocalDifficulty: song.vocalDifficulty,
    singalongScore: song.singalongScore,
    peakHourScore: song.peakHourScore,
    transitionFlexibility: song.transitionFlexibility,
    audienceAgeAppeal: song.audienceAgeAppeal,
    femaleParticipationScore: song.femaleParticipationScore,
    openerCandidate: song.openerCandidate,
    closerCandidate: song.closerCandidate,
  };
}

function lookupPayloadFromForm(song: Song, form: SongForm) {
  return {
    id: song.id,
    title: form.title.trim() || song.title,
    artist: form.artist.trim() || song.artist,
    bpm: parseBpm(form.bpm),
    musicalKey: form.musicalKey.trim() || null,
    durationSec: parseDuration(form.durationSec),
    energy: parseRating(form.energy),
    genre: form.genre.trim() || null,
    vibe: form.vibe.trim() || null,
    crowdScore: parseRating(form.crowdScore),
    danceability: parseRating(form.danceability),
    vocalDifficulty: parseRating(form.vocalDifficulty),
    singalongScore: parseRating(form.singalongScore),
    peakHourScore: parseRating(form.peakHourScore),
    transitionFlexibility: parseRating(form.transitionFlexibility),
    audienceAgeAppeal: form.audienceAgeAppeal.length ? form.audienceAgeAppeal : null,
    femaleParticipationScore: parseRating(form.femaleParticipationScore),
    openerCandidate: form.openerCandidate,
    closerCandidate: form.closerCandidate,
  };
}

function smartSummary(song: Song) {
  const ratingParts = [
    song.energy != null ? `E${formatRating(song.energy)}` : null,
    song.crowdScore != null ? `C${formatRating(song.crowdScore)}` : null,
    song.danceability != null ? `D${formatRating(song.danceability)}` : null,
    song.vocalDifficulty != null ? `V${formatRating(song.vocalDifficulty)}` : null,
    song.singalongScore != null ? `S${formatRating(song.singalongScore)}` : null,
    song.peakHourScore != null ? `P${formatRating(song.peakHourScore)}` : null,
    song.femaleParticipationScore != null ? `F${formatRating(song.femaleParticipationScore)}` : null,
  ].filter(Boolean);
  const contextParts = [
    song.genre ? `G:${song.genre}` : null,
    song.vibe ? `Vibe:${song.vibe}` : null,
    song.audienceAgeAppeal?.length ? `Ages:${song.audienceAgeAppeal.slice(0, 2).join("/")}` : null,
    song.capoOrTuning ? `Tune:${song.capoOrTuning}` : null,
    song.openerCandidate ? "Opener" : null,
    song.closerCandidate ? "Closer" : null,
    song.avoidAfter ? "Avoids" : null,
  ].filter(Boolean);

  const metadataCount = ratingParts.length + contextParts.length;
  if (metadataCount === 0) return "Missing";

  const hasCoreRatings = song.energy != null && song.crowdScore != null && song.danceability != null && song.vocalDifficulty != null && song.singalongScore != null && song.peakHourScore != null;
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
        ["Hard", "8"],
      ]
    : [
        ["Low", "3"],
        ["Medium", "6"],
        ["High", "8"],
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

function sourceLabel(value?: string | null) {
  if (value === "inferred") return "Inferred";
  if (value === "manual") return "Manual Override";
  return null;
}

function FieldSource({ value }: { value?: string | null }) {
  const label = sourceLabel(value);
  if (!label) return null;
  return <span className="ml-2 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">{label}</span>;
}

function OptionalMetadata({ form, onChange, defaultOpen = false, sourceSong }: { form: SongForm; onChange: (patch: Partial<SongForm>) => void; defaultOpen?: boolean; sourceSong?: Song }) {
  const toggleAge = (age: string) => {
    const selected = new Set(form.audienceAgeAppeal);
    if (selected.has(age)) selected.delete(age);
    else selected.add(age);
    onChange({ audienceAgeAppeal: [...selected] });
  };

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
            <MetadataField label="Singalong Score (1-10)" helper="How likely the audience is to sing along">
              <input className="input" type="number" min="1" max="10" step="1" value={form.singalongScore} onChange={(e) => onChange({ singalongScore: e.target.value })} />
              <RatingPresets value={form.singalongScore} onPick={(value) => onChange({ singalongScore: value })} />
              <FieldSource value={sourceSong?.singalongScoreSource} />
            </MetadataField>
            <MetadataField label="Peak Hour Score (1-10)" helper="How effective this song is during the highest-energy portion of the night">
              <input className="input" type="number" min="1" max="10" step="1" value={form.peakHourScore} onChange={(e) => onChange({ peakHourScore: e.target.value })} />
              <RatingPresets value={form.peakHourScore} onPick={(value) => onChange({ peakHourScore: value })} />
              <FieldSource value={sourceSong?.peakHourScoreSource} />
            </MetadataField>
            <MetadataField label="Transition Flexibility (1-10)" helper="How easily the song fits before or after a wide variety of songs">
              <input className="input" type="number" min="1" max="10" step="1" value={form.transitionFlexibility} onChange={(e) => onChange({ transitionFlexibility: e.target.value })} />
              <RatingPresets value={form.transitionFlexibility} onPick={(value) => onChange({ transitionFlexibility: value })} />
              <FieldSource value={sourceSong?.transitionFlexibilitySource} />
            </MetadataField>
            <MetadataField label="Female Participation Score (1-10)" helper="How likely the song is to drive female audience engagement, singing, dancing, or participation">
              <input className="input" type="number" min="1" max="10" step="1" value={form.femaleParticipationScore} onChange={(e) => onChange({ femaleParticipationScore: e.target.value })} />
              <RatingPresets value={form.femaleParticipationScore} onPick={(value) => onChange({ femaleParticipationScore: value })} />
              <FieldSource value={sourceSong?.femaleParticipationScoreSource} />
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
            <MetadataField label="Audience Age Appeal" helper="Audience groups that typically respond well to the song">
              <div className="flex flex-wrap gap-1.5">
                {audienceAgeOptions.map((age) => (
                  <button
                    key={age}
                    type="button"
                    className={`btn px-2 py-1 text-[11px] ${form.audienceAgeAppeal.includes(age) ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => toggleAge(age)}
                  >
                    {age}
                  </button>
                ))}
              </div>
              <FieldSource value={sourceSong?.audienceAgeAppealSource} />
            </MetadataField>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Performance notes</h3>
          <div className="grid gap-3 sm:grid-cols-2">
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
  const [bulkEnrichBusy, setBulkEnrichBusy] = useState(false);
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState<BulkEnrichProgress | null>(null);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [songSearch, setSongSearch] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const bulkEnrichCancelRef = useRef(false);

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
  const duplicateFilteredSongs = shouldShowDuplicatesOnly ? songs.filter((song) => duplicateSongIds.has(song.id)) : songs;
  const visibleSongs = duplicateFilteredSongs.filter((song) => songMatchesSearch(song, songSearch));
  const duplicateGroupCount = new Set(
    songs.map((song) => duplicateKey(song)).filter((key) => (duplicateCounts.get(key) ?? 0) > 1),
  ).size;
  const missingBpmCount = songs.filter((song) => song.bpm == null).length;
  const bulkEnrichCandidateCount = songs.filter((song) => missingBulkEnrichmentFields(song).length > 0).length;
  const anyBulkBusy = bulkBusy || bulkEnrichBusy;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/songs", { cache: "no-store" });
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
      ["Singalong score", current.singalongScore],
      ["Peak hour score", current.peakHourScore],
      ["Transition flexibility", current.transitionFlexibility],
      ["Female participation score", current.femaleParticipationScore],
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

  async function importSongLibrary(file: File | null) {
    if (!file) return;
    setCsvBusy(true);
    setMsg(null);
    const text = await file.text();
    const r = await fetch("/api/import/csv", { method: "POST", body: text });
    const data = await r.json();
    setCsvBusy(false);
    if (!r.ok) setMsg(data.error?.join?.() ?? JSON.stringify(data));
    else {
      const errorNote = data.errors?.length ? ` ${data.errors.length} row issue(s) logged.` : "";
      setMsg(`${data.format ?? "File"} import complete: ${data.created ?? 0} created, ${data.matched ?? 0} reused, ${data.updated ?? 0} updated, ${data.duplicatesSkipped ?? 0} duplicates skipped, ${data.skipped ?? 0} skipped.${errorNote}`);
    }
    await load();
  }

  async function lookupEnrichment(song: Song, route = "/api/metadata/lookup") {
    const payload = editingId === song.id ? lookupPayloadFromForm(song, editForm) : lookupPayloadFromSong(song);
    const response = await fetch(route, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as MetadataLookupResult | { error?: unknown; message?: string } | null;
    if (!response.ok && (!data || !("source" in data))) {
      if (response.status === 401) throw new Error("You are not logged in or your session expired. Please log in again.");
      const detail = data && "error" in data && typeof data.error === "string" ? data.error : data?.message;
      throw new Error(detail ?? `Enrichment lookup failed (${response.status}).`);
    }
    if (!data || !("source" in data)) throw new Error("Enrichment lookup returned an unexpected response.");
    return data;
  }

  async function lookupBpm(song: Song) {
    const identity = lookupIdentity(song);
    setMsg(null);
    setSmartPreview(null);
    setSmartStatus(song.id, `Looking up BPM for ${identity.title} - ${identity.artist}...`);
    setSmartBusyId(song.id);

    let result: MetadataLookupResult;
    try {
      result = await lookupEnrichment(song, "/api/bpm-lookup");
    } catch (error) {
      const message = error instanceof Error ? error.message : "BPM lookup failed.";
      setSmartBusyId(null);
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    const bpmProposal = result.proposals.find((item) => item.field === "bpm" && item.status === "found" && typeof item.proposed === "number");
    const durationProposal = result.proposals.find((item) => item.field === "durationSec" && item.status === "found" && typeof item.proposed === "number");

    if (!bpmProposal) {
      const message = `BPM was not found for ${identity.title} - ${identity.artist}.`;
      setSmartBusyId(null);
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    const body: Record<string, unknown> = { bpm: bpmProposal.proposed };
    if (durationProposal) body.durationSec = durationProposal.proposed;

    setSavingId(song.id);
    const response = await fetch(`/api/songs/${song.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSavingId(null);
    setSmartBusyId(null);

    if (!response.ok) {
      const message = await readErrorMessage(response);
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    const updated = (await response.json()) as Song;
    setSongs((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    if (editingId === updated.id) setEditForm(editFormFromSong(updated));
    const message = `Updated BPM for ${updated.title}${durationProposal ? " and duration" : ""}.`;
    setSmartStatus(song.id, message);
    setMsg(message);
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

  function applySmartResultToEditForm(result: MetadataLookupResult, overwrite = false) {
    setEditForm((current) => ({
      ...current,
      ...result.proposals.reduce<Partial<SongForm>>((patch, item) => {
        if (item.status !== "found" || !hasValue(item.proposed)) return patch;
        const currentValue = formValue(current, item.field);
        if (!overwrite && !canFillMissing(currentValue)) return patch;
        if (item.field === "durationSec" && typeof item.proposed === "number") patch.durationSec = formatDuration(item.proposed);
        else if (["bpm", "energy", "crowdScore", "danceability", "vocalDifficulty", "singalongScore", "peakHourScore", "transitionFlexibility", "femaleParticipationScore"].includes(item.field) && typeof item.proposed === "number") {
          patch[item.field as "bpm" | "energy" | "crowdScore" | "danceability" | "vocalDifficulty" | "singalongScore" | "peakHourScore" | "transitionFlexibility" | "femaleParticipationScore"] = item.field === "bpm" ? String(item.proposed) : formatRating(item.proposed);
        } else if (item.field === "audienceAgeAppeal" && Array.isArray(item.proposed)) {
          patch.audienceAgeAppeal = item.proposed;
        } else if (item.field === "openerCandidate" || item.field === "closerCandidate") {
          patch[item.field] = Boolean(item.proposed);
        } else if (typeof item.proposed === "string") {
          patch[item.field as "title" | "artist" | "genre" | "vibe" | "musicalKey"] = item.proposed;
        }
        return patch;
      }, {}),
    }));
  }

  async function lookupSmartData(song: Song, route = "/api/metadata/lookup") {
    const identity = lookupIdentity(song);
    setMsg(null);
    setSmartPreview(null);
    setSmartStatus(song.id, `Enriching metadata for ${identity.title} - ${identity.artist}...`);
    setSmartBusyId(song.id);

    let data: MetadataLookupResult | null = null;
    try {
      data = await lookupEnrichment(song, route);
      console.debug("Metadata enrichment lookup", { title: identity.title, artist: identity.artist, response: data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metadata enrichment failed.";
      setSmartBusyId(null);
      setSmartStatus(song.id, message);
      setMsg(message);
      return;
    }

    setSmartBusyId(null);

    const matchedMessage = `Matched ${data.matchedTitle ?? identity.title} by ${data.matchedArtist ?? identity.artist}.`;
    setSmartPreview({ songId: song.id, result: data });
    setSmartStatus(song.id, data.message ? `${matchedMessage} ${data.message}` : `${matchedMessage} Review found and unavailable fields before applying.`);
    setMsg(data.message ?? `${matchedMessage} Review found and unavailable fields before applying.`);
  }

  async function applySmartData(song: Song, result: MetadataLookupResult, overwrite = false) {
    if (overwrite && !confirm("Apply all proposed metadata and overwrite existing populated fields?")) return;
    if (editingId === song.id) {
      applySmartResultToEditForm(result, overwrite);
      setSmartPreview(null);
      setSmartStatus(song.id, overwrite ? "Applied all proposed metadata to the edit row. Review, then click Save." : "Applied missing metadata to the edit row. Review, then click Save.");
      return;
    }

    const body: Record<string, unknown> = {};
    for (const item of result.proposals) {
      if (item.status !== "found" || !hasValue(item.proposed)) continue;
      if (!overwrite && !canFillMissing(songValue(song, item.field))) continue;
      body[item.field] = item.proposed;
      if (item.field === "singalongScore") body.singalongScoreSource = "inferred";
      if (item.field === "peakHourScore") body.peakHourScoreSource = "inferred";
      if (item.field === "transitionFlexibility") body.transitionFlexibilitySource = "inferred";
      if (item.field === "audienceAgeAppeal") body.audienceAgeAppealSource = "inferred";
      if (item.field === "femaleParticipationScore") body.femaleParticipationScoreSource = "inferred";
    }

    if (Object.keys(body).length === 0) {
      setMsg(result.message ?? "Enrichment lookup did not return missing fields to apply.");
      return;
    }

    setSavingId(song.id);
    const response = await fetch(`/api/songs/${song.id}`, {
      method: "PATCH",
      credentials: "same-origin",
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
    setSmartStatus(song.id, result.message ?? `Applied enrichment for ${updated.title}.`);
    setMsg(result.message ?? `Applied enrichment for ${updated.title}.`);
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
    let authErrorMessage: string | null = null;

    for (const [index, song] of targets.entries()) {
      setMsg(`Enriching BPMs ${index + 1}/${targets.length}: ${song.title}`);
      const result = await lookupEnrichment(song, "/api/bpm-lookup").catch((error) => {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("not logged in") || message.includes("session expired")) authErrorMessage = message;
        return null;
      });
      if (authErrorMessage) break;
      const bpmProposal = result?.proposals.find((item) => item.field === "bpm" && item.status === "found" && typeof item.proposed === "number");
      if (bpmProposal) {
        const durationProposal = result?.proposals.find((item) => item.field === "durationSec" && item.status === "found" && typeof item.proposed === "number");
        const patch = await fetch(`/api/songs/${song.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bpm: bpmProposal.proposed,
            durationSec: song.durationSec == null && durationProposal ? durationProposal.proposed : song.durationSec,
          }),
        });
        if (!patch.ok) {
          misses.push(song.title);
          continue;
        }
        const updated = (await patch.json()) as Song;
        updatedCount += 1;
        setSongs((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      } else {
        misses.push(song.title);
      }
    }

    setBulkBusy(false);
    setMsg(
      authErrorMessage ??
      (misses.length > 0
        ? `Updated ${updatedCount} BPM${updatedCount === 1 ? "" : "s"}. ${misses.length} still need manual BPM entry.`
        : `Updated ${updatedCount} BPM${updatedCount === 1 ? "" : "s"}.`),
    );
  }

  async function enrichMetadataForAll() {
    if (bulkEnrichBusy) return;
    bulkEnrichCancelRef.current = false;
    setMsg(null);
    setSmartPreview(null);
    setBulkEnrichBusy(true);

    let progress: BulkEnrichProgress = {
      total: songs.length,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
    setBulkEnrichProgress(progress);
    let authErrorMessage: string | null = null;

    const setProgress = (patch: Partial<BulkEnrichProgress>) => {
      progress = { ...progress, ...patch };
      setBulkEnrichProgress(progress);
    };

    for (const [index, song] of songs.entries()) {
      if (bulkEnrichCancelRef.current) break;

      const missingFields = missingBulkEnrichmentFields(song);
      if (missingFields.length === 0) {
        setProgress({ processed: progress.processed + 1, skipped: progress.skipped + 1 });
        continue;
      }

      setMsg(`Enriching metadata ${index + 1}/${songs.length}: ${song.title}`);

      try {
        const result = await lookupEnrichment(song);
        const body: Record<string, unknown> = {};

        for (const item of result.proposals) {
          if (!bulkEnrichmentFields.includes(item.field)) continue;
          if (item.status !== "found" || !hasValue(item.proposed)) continue;
          if (!canFillMissing(songValue(song, item.field))) continue;
          body[item.field] = item.proposed;
          if (item.field === "singalongScore") body.singalongScoreSource = "inferred";
          if (item.field === "peakHourScore") body.peakHourScoreSource = "inferred";
          if (item.field === "transitionFlexibility") body.transitionFlexibilitySource = "inferred";
          if (item.field === "audienceAgeAppeal") body.audienceAgeAppealSource = "inferred";
          if (item.field === "femaleParticipationScore") body.femaleParticipationScoreSource = "inferred";
        }

        if (Object.keys(body).length === 0) {
          setProgress({ processed: progress.processed + 1, skipped: progress.skipped + 1 });
        } else {
          const response = await fetch(`/api/songs/${song.id}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!response.ok) throw new Error(await readErrorMessage(response));

          const updated = (await response.json()) as Song;
          setSongs((current) => current.map((row) => (row.id === updated.id ? updated : row)));
          setProgress({ processed: progress.processed + 1, updated: progress.updated + 1 });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("not logged in") || message.includes("session expired")) {
          setProgress({ processed: progress.processed + 1, failed: progress.failed + 1 });
          bulkEnrichCancelRef.current = true;
          authErrorMessage = message;
          setMsg(message);
          break;
        }
        setProgress({ processed: progress.processed + 1, failed: progress.failed + 1 });
      }

      if ((index + 1) % 5 === 0 && !bulkEnrichCancelRef.current) await sleep(600);
    }

    setBulkEnrichBusy(false);
    setMsg(
      authErrorMessage ??
      (bulkEnrichCancelRef.current
        ? `Stopped metadata enrichment after ${progress.processed}/${progress.total}. Updated ${progress.updated}, skipped ${progress.skipped}, failed ${progress.failed}.`
        : `Metadata enrichment complete. Processed ${progress.processed}/${progress.total}. Updated ${progress.updated}, skipped ${progress.skipped}, failed ${progress.failed}.`),
    );
  }

  function cancelBulkEnrichment() {
    bulkEnrichCancelRef.current = true;
    setMsg("Stopping metadata enrichment after the current song finishes...");
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
          CSV columns: title, artist, bpm, key, duration_sec, energy, notes, genre, vibe, crowd_score, danceability, vocal_difficulty, singalong_score, peak_hour_score, transition_flexibility, audience_age_appeal, female_participation_score, opener_candidate, closer_candidate, capo_or_tuning, avoid_after.
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

        <div className="card space-y-4">
          <div>
            <h2 className="font-medium">Import CSV or HTML</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              CSV files and table-based HTML exports are supported. Existing songs are matched by normalized title and artist so importing the same file twice will reuse the library song.
            </p>
          </div>
          <input
            type="file"
            accept=".csv,text/csv,.html,.htm,text/html"
            disabled={csvBusy}
            onChange={(e) => void importSongLibrary(e.target.files?.[0] ?? null)}
            className="text-sm text-[var(--muted)]"
          />
          <div className="rounded-md border border-[var(--border)] bg-black/10 p-3 text-xs text-[var(--muted)]">
            <p className="font-medium text-[var(--fg)]">CSV or HTML import supported</p>
            <p className="mt-2">Required field: <span className="font-mono text-[var(--fg)]">title</span></p>
            <p className="mt-1">
              Optional fields: artist, key, capo, bpm, duration, energy, genre, notes, vibe, crowd_score, danceability, vocal_difficulty, singalong_score, peak_hour_score, transition_flexibility, audience_age_appeal, female_participation_score, opener_candidate, closer_candidate, capo_or_tuning, avoid_after.
            </p>
            <p className="mt-2">Common aliases work too, including song, name, performer, musical_key, tempo, length, comments, style, and mood.</p>
            <p className="mt-2">HTML imports should use a table with headers like Title, Artist, Key, and Capo. SET marker rows such as SET 2 or Set 3 are ignored.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <pre className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2">title,artist,key,bpm{"\n"}Example Song,Example Artist,G,120</pre>
              <pre className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2">&lt;table&gt;{"\n"}  &lt;tr&gt;&lt;th&gt;Title&lt;/th&gt;&lt;th&gt;Artist&lt;/th&gt;&lt;/tr&gt;{"\n"}  &lt;tr&gt;&lt;td&gt;Example Song&lt;/td&gt;&lt;td&gt;Example Artist&lt;/td&gt;&lt;/tr&gt;{"\n"}&lt;/table&gt;</pre>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => downloadTextTemplate("band-setlist-song-import-template.csv", csvImportTemplate, "text/csv")}>
              Download CSV template
            </button>
            <button type="button" className="btn" onClick={() => downloadTextTemplate("band-setlist-song-import-template.html", htmlImportTemplate, "text/html")}>
              Download HTML template
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Library ({loading ? "..." : songs.length})</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Showing {loading ? "..." : visibleSongs.length} of {songs.length} songs
            </p>
            {duplicateSongIds.size > 0 && (
              <p className="mt-1 text-xs text-amber-200">
                {duplicateSongIds.size} duplicate songs across {duplicateGroupCount} duplicate group{duplicateGroupCount === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex min-w-64 items-center gap-2">
              <input
                className="input h-9 px-3 py-1.5 text-sm"
                placeholder="Search title, artist, genre, key, notes"
                value={songSearch}
                onChange={(event) => setSongSearch(event.target.value)}
              />
              {songSearch && (
                <button type="button" className="btn btn-ghost h-9 px-3 py-1.5 text-xs" onClick={() => setSongSearch("")}>
                  Clear
                </button>
              )}
            </div>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={loading || anyBulkBusy || (!showDuplicatesOnly && duplicateSongIds.size === 0)} onClick={() => setShowDuplicatesOnly((value) => !value)}>
              {shouldShowDuplicatesOnly ? "Show all songs" : `Show duplicates (${duplicateSongIds.size})`}
            </button>
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={loading || anyBulkBusy || bulkEnrichCandidateCount === 0} onClick={() => void enrichMetadataForAll()}>
              {bulkEnrichBusy ? "Enriching all" : `Enrich Metadata for All (${bulkEnrichCandidateCount})`}
            </button>
            {bulkEnrichBusy && (
              <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={cancelBulkEnrichment}>
                Stop
              </button>
            )}
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={loading || anyBulkBusy || missingBpmCount === 0} onClick={() => void lookupMissingBpms()}>
              {bulkBusy ? "Looking up BPMs" : `Lookup missing BPMs (${missingBpmCount})`}
            </button>
          </div>
        </div>
        {bulkEnrichProgress && (
          <div className="mb-3 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2 text-xs text-[var(--muted)]">
            <span className="font-medium text-[var(--text)]">Bulk enrichment:</span>{" "}
            total {bulkEnrichProgress.total} · processed {bulkEnrichProgress.processed} · updated {bulkEnrichProgress.updated} · skipped {bulkEnrichProgress.skipped} · failed {bulkEnrichProgress.failed}
          </div>
        )}
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
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className="btn btn-primary mr-2 px-2 py-1 text-xs" disabled={savingId === s.id} onClick={() => void saveEdit(s)}>{savingId === s.id ? "Saving" : "Save"}</button>
                        <button type="button" className="btn btn-ghost mr-2 px-2 py-1 text-xs" disabled={anyBulkBusy || smartBusyId === s.id || savingId === s.id} onClick={() => void lookupBpm(s)}>{smartBusyId === s.id ? "Looking..." : "Lookup BPM"}</button>
                        <button type="button" className="btn btn-ghost mr-2 px-2 py-1 text-xs" disabled={anyBulkBusy || smartBusyId === s.id || savingId === s.id} onClick={() => void lookupSmartData(s)}>{smartBusyId === s.id ? "Enriching..." : "Enrich metadata"}</button>
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => startEdit(s)}>Edit</button>
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={anyBulkBusy || smartBusyId === s.id || savingId === s.id} onClick={() => void lookupBpm(s)}>{smartBusyId === s.id ? "Looking..." : "Lookup BPM"}</button>
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={anyBulkBusy || smartBusyId === s.id || savingId === s.id} onClick={() => void lookupSmartData(s)}>{smartBusyId === s.id ? "Enriching..." : "Enrich metadata"}</button>
                        <button type="button" className="btn btn-ghost px-2 py-1 text-xs text-rose-300" onClick={() => void remove(s.id)}>Del</button>
                      </div>
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
                          <span className="text-[var(--muted)]">Use the current edit row values for Deezer, MusicBrainz, Last.fm, and local library enrichment.</span>
                          <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={anyBulkBusy || smartBusyId === s.id || savingId === s.id} onClick={() => void lookupSmartData(s)}>
                            {smartBusyId === s.id ? "Enriching..." : "Enrich metadata"}
                          </button>
                        </div>
                        <OptionalMetadata form={editForm} defaultOpen sourceSong={s} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />
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
                            <h3 className="font-medium text-[var(--accent)]">Metadata enrichment preview</h3>
                            <p className="mt-1 text-[var(--muted)]">
                              {smartPreview.result.matchedTitle ?? s.title} - {smartPreview.result.matchedArtist ?? s.artist}
                            </p>
                            <p className="mt-1 text-xs text-[var(--muted)]">Sources tried: {smartPreview.result.sourcesTried.join(", ")}</p>
                            {smartPreview.result.message && <p className="mt-1 text-xs text-amber-200">{smartPreview.result.message}</p>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={savingId === s.id} onClick={() => void applySmartData(s, smartPreview.result, false)}>
                              {savingId === s.id ? "Applying" : "Apply missing"}
                            </button>
                            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={savingId === s.id} onClick={() => void applySmartData(s, smartPreview.result, true)}>
                              Apply all
                            </button>
                            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => setSmartPreview(null)}>Cancel</button>
                          </div>
                        </div>
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full min-w-[720px] text-left text-xs">
                            <thead className="text-[var(--muted)]">
                              <tr>
                                <th className="pb-2 pr-3">Field</th>
                                <th className="pb-2 pr-3">Current</th>
                                <th className="pb-2 pr-3">Proposed</th>
                                <th className="pb-2 pr-3">Source</th>
                                <th className="pb-2">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...smartPreview.result.proposals, ...smartPreview.result.unavailable].map((item) => {
                                const found = item.status === "found";
                                const fillsMissing = found && canFillMissing(item.current);
                                return (
                                  <tr key={`${item.field}-${item.source}`} className="border-t border-[var(--border)]">
                                    <td className="py-2 pr-3 font-medium text-[var(--text)]">{enrichmentFieldLabel(item.field)}</td>
                                    <td className="py-2 pr-3 text-[var(--muted)]">{formatPreviewValue(item.current)}</td>
                                    <td className="py-2 pr-3">{found ? formatPreviewValue(item.proposed) : "not found"}</td>
                                    <td className="py-2 pr-3 text-[var(--muted)]">
                                      <span>{item.source}</span>
                                      {item.note && <span className="block text-[11px]">{item.note}</span>}
                                    </td>
                                    <td className="py-2">
                                      {found ? (
                                        <span className={fillsMissing ? "text-emerald-300" : "text-amber-200"}>
                                          {fillsMissing ? "found - will apply by default" : "found - apply all required"}
                                        </span>
                                      ) : (
                                        <span className="text-[var(--muted)]">not found</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>,
                );
              }

              return rows;
            })}</tbody>
        </table>
        {visibleSongs.length === 0 && (
          <div className="py-6 text-sm text-[var(--muted)]">
            {songSearch.trim()
              ? "No songs match your search."
              : shouldShowDuplicatesOnly
                ? "No duplicate songs found."
                : "No songs found."}
          </div>
        )}
      </div>
    </div>
  );
}
