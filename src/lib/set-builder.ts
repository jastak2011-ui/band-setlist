export type SetlistStrategy = "balanced" | "high-energy" | "dance-heavy" | "singalong-heavy" | "acoustic-chill" | "build-slowly";

export type SmartBuildOptions = {
  strategy?: SetlistStrategy;
  avoidSameArtist?: boolean;
  avoidSameGenre?: boolean;
  avoidBigBpmDrops?: boolean;
  avoidHardVocals?: boolean;
  saveStrongestForLater?: boolean;
};

export type SongForSet = {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  musicalKey: string | null;
  durationSec: number | null;
  energy: number | null;
  genre?: string | null;
  vibe?: string | null;
  crowdScore?: number | null;
  danceability?: number | null;
  vocalDifficulty?: number | null;
  openerCandidate?: boolean | null;
  closerCandidate?: boolean | null;
  leadSinger?: string | null;
  capoOrTuning?: string | null;
  avoidAfter?: string | null;
};

const defaultOptions: Required<SmartBuildOptions> = {
  strategy: "balanced",
  avoidSameArtist: true,
  avoidSameGenre: true,
  avoidBigBpmDrops: true,
  avoidHardVocals: true,
  saveStrongestForLater: true,
};

function effectiveBpm(song: SongForSet): number {
  return song.bpm ?? 120;
}

function normalizeRating(value: number | null | undefined, fallback = 0.5) {
  if (value == null) return fallback;
  return Math.max(0, Math.min(1, value > 1 ? value / 10 : value));
}

function effectiveEnergy(song: SongForSet): number {
  if (song.energy != null) return normalizeRating(song.energy);
  const bpm = effectiveBpm(song);
  return Math.max(0.25, Math.min(0.9, (bpm - 70) / 100));
}

function scoreValue(value: number | null | undefined, fallback = 0.5) {
  return normalizeRating(value, fallback);
}

function sameText(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function songStrength(song: SongForSet, options: Required<SmartBuildOptions>) {
  const crowd = scoreValue(song.crowdScore);
  const dance = scoreValue(song.danceability);
  const energy = effectiveEnergy(song);
  if (options.strategy === "dance-heavy") return dance * 0.5 + crowd * 0.25 + energy * 0.25;
  if (options.strategy === "singalong-heavy") return crowd * 0.55 + dance * 0.2 + energy * 0.25;
  if (options.strategy === "acoustic-chill") return crowd * 0.45 + (1 - energy) * 0.35 + dance * 0.2;
  return crowd * 0.35 + dance * 0.3 + energy * 0.35;
}

function targetEnergy(slotIndex: number, setLength: number, options: Required<SmartBuildOptions>) {
  if (setLength <= 1) return 0.75;
  const progress = slotIndex / (setLength - 1);
  switch (options.strategy) {
    case "high-energy":
      return 0.78 + Math.sin(progress * Math.PI) * 0.12;
    case "dance-heavy":
      return 0.72 + progress * 0.16;
    case "singalong-heavy":
      return 0.64 + progress * 0.18;
    case "acoustic-chill":
      return 0.42 + Math.sin(progress * Math.PI) * 0.12;
    case "build-slowly":
      return 0.42 + progress * 0.42;
    default:
      return 0.58 + Math.sin(progress * Math.PI) * 0.18 + progress * 0.08;
  }
}

function avoidsPrevious(song: SongForSet, previous: SongForSet | null) {
  if (!song.avoidAfter || !previous) return false;
  const avoidTokens = song.avoidAfter
    .toLowerCase()
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const previousValues = [previous.id, previous.title, previous.artist, previous.genre, previous.vibe]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return avoidTokens.some((token) => previousValues.some((value) => value.includes(token)));
}

function lowEnergyRun(output: SongForSet[]) {
  let count = 0;
  for (let i = output.length - 1; i >= 0; i--) {
    if (effectiveEnergy(output[i]) >= 0.45) break;
    count++;
  }
  return count;
}

function chooseSongForSlot(
  remaining: SongForSet[],
  output: SongForSet[],
  slotIndex: number,
  setLength: number,
  options: Required<SmartBuildOptions>,
) {
  const previous = output[output.length - 1] ?? null;
  const finalSlot = slotIndex === setLength - 1;
  const firstSlot = slotIndex === 0;
  const progress = setLength <= 1 ? 1 : slotIndex / (setLength - 1);
  const desiredEnergy = targetEnergy(slotIndex, setLength, options);

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < remaining.length; i++) {
    const candidate = remaining[i];
    const energy = effectiveEnergy(candidate);
    const crowd = scoreValue(candidate.crowdScore);
    const dance = scoreValue(candidate.danceability);
    const vocal = scoreValue(candidate.vocalDifficulty, 0.35);
    const strength = songStrength(candidate, options);

    // Core curve: each slot has a target energy, so the set can breathe instead of sorting by title or BPM.
    let score = 8 - Math.abs(energy - desiredEnergy) * 8;

    // Strategy weights nudge the same pool toward different practical live-show goals.
    if (options.strategy === "dance-heavy") score += dance * 3 + crowd;
    else if (options.strategy === "singalong-heavy") score += crowd * 3 + dance;
    else if (options.strategy === "acoustic-chill") score += (1 - energy) * 2 + crowd;
    else if (options.strategy === "high-energy") score += energy * 2 + dance;
    else score += crowd * 1.4 + dance * 1.1;

    // Openers should feel known and awake; closers should feel strong, familiar, and high-impact.
    if (firstSlot) score += (candidate.openerCandidate ? 5 : 0) + crowd * 2 + energy * 1.5;
    if (finalSlot) score += (candidate.closerCandidate ? 6 : 0) + strength * 4;

    // Saving the strongest material for later avoids burning all the big songs too early.
    if (options.saveStrongestForLater) score += strength * progress * 2.5 - strength * (1 - progress) * 0.75;

    if (previous) {
      const bpmDrop = effectiveBpm(previous) - effectiveBpm(candidate);
      const bpmDiff = Math.abs(effectiveBpm(previous) - effectiveBpm(candidate));
      score -= bpmDiff / 55;

      if (options.avoidSameArtist && sameText(candidate.artist, previous.artist)) score -= 7;
      if (options.avoidSameGenre && sameText(candidate.genre, previous.genre)) score -= 2.5;
      if (sameText(candidate.vibe, previous.vibe)) score -= 1.25;
      if (options.avoidBigBpmDrops && !["acoustic-chill", "build-slowly"].includes(options.strategy) && bpmDrop > 18) score -= (bpmDrop - 18) / 4;
      if (options.avoidHardVocals && vocal >= 0.72 && scoreValue(previous.vocalDifficulty, 0.35) >= 0.72) score -= 5;
      if (avoidsPrevious(candidate, previous)) score -= 10;
    }

    // More than two lower-energy songs in a row can make a live room sag.
    if (energy < 0.45 && lowEnergyRun(output) >= 2) score -= 8;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return remaining.splice(bestIndex, 1)[0];
}

function splitEvenlyForSets(songs: SongForSet[], numSets: number, options: Required<SmartBuildOptions>) {
  const sets = Array.from({ length: numSets }, (_, index) => ({ index, songs: [] as SongForSet[] }));
  const sorted = [...songs].sort((a, b) => songStrength(b, options) - songStrength(a, options));

  for (const song of sorted) {
    sets.sort((a, b) => a.songs.length - b.songs.length || a.index - b.index);
    sets[0].songs.push(song);
  }

  return sets.sort((a, b) => a.index - b.index).map((set) => set.songs);
}

function reorderSetForSmartFlow(songs: SongForSet[], options: Required<SmartBuildOptions>): SongForSet[] {
  if (songs.length <= 1) return [...songs];

  const remaining = [...songs];
  const output: SongForSet[] = [];
  while (remaining.length) {
    output.push(chooseSongForSlot(remaining, output, output.length, songs.length, options));
  }
  return output;
}

/**
 * Build balanced live sets from the selected song pool. The scoring is deliberately local and transparent:
 * distribute songs evenly, then pick each next slot by energy curve, transition quality, variety, and closer/opening bonuses.
 */
export function buildSets(songs: SongForSet[], numSets: number, options: SmartBuildOptions = {}): SongForSet[][] {
  if (numSets < 1) throw new Error("Need at least one set");
  if (songs.length === 0) return Array.from({ length: numSets }, () => []);

  const resolvedOptions = { ...defaultOptions, ...options };
  const sets = splitEvenlyForSets(songs, numSets, resolvedOptions);
  return sets.map((set) => reorderSetForSmartFlow(set, resolvedOptions));
}



