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
  singalongScore?: number | null;
  peakHourScore?: number | null;
  transitionFlexibility?: number | null;
  femaleParticipationScore?: number | null;
  audienceAgeAppeal?: string[] | null;
  openerCandidate?: boolean | null;
  closerCandidate?: boolean | null;
  capoOrTuning?: string | null;
  avoidAfter?: string | null;
};

export type SetBuildExplanation = {
  openerReasons: Array<{ setIndex: number; songId: string; title: string; reasons: string[] }>;
  closerReasons: Array<{ setIndex: number; songId: string; title: string; reasons: string[] }>;
  topEngagementSongs: Array<{ songId: string; title: string; score: number }>;
  peakHourSongs: Array<{ songId: string; title: string; score: number }>;
  energyFlowMoves: string[];
  audienceAgeDistribution: Array<{ age: string; count: number }>;
  averageEngagementScore: number;
  averageEnergyScore: number;
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

function audienceEngagementScore(song: SongForSet) {
  return (
    scoreValue(song.singalongScore, scoreValue(song.crowdScore)) * 0.35
    + scoreValue(song.danceability) * 0.25
    + scoreValue(song.crowdScore) * 0.2
    + scoreValue(song.femaleParticipationScore, scoreValue(song.danceability)) * 0.2
  );
}

function sameText(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function songStrength(song: SongForSet, options: Required<SmartBuildOptions>) {
  const crowd = scoreValue(song.crowdScore);
  const dance = scoreValue(song.danceability);
  const singalong = scoreValue(song.singalongScore, crowd);
  const female = scoreValue(song.femaleParticipationScore, dance);
  const peak = scoreValue(song.peakHourScore, Math.max(crowd, dance));
  const flex = scoreValue(song.transitionFlexibility);
  const energy = effectiveEnergy(song);
  const engagement = audienceEngagementScore(song);
  if (options.strategy === "dance-heavy") return dance * 0.32 + female * 0.22 + peak * 0.18 + crowd * 0.14 + energy * 0.14;
  if (options.strategy === "singalong-heavy") return singalong * 0.38 + crowd * 0.26 + female * 0.14 + peak * 0.12 + energy * 0.1;
  if (options.strategy === "acoustic-chill") return crowd * 0.28 + flex * 0.26 + (1 - energy) * 0.22 + singalong * 0.14 + dance * 0.1;
  return engagement * 0.42 + energy * 0.18 + peak * 0.16 + flex * 0.12 + crowd * 0.12;
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

function highEnergyRun(output: SongForSet[]) {
  let count = 0;
  for (let i = output.length - 1; i >= 0; i--) {
    if (effectiveEnergy(output[i]) < 0.72) break;
    count++;
  }
  return count;
}

function targetPatternEnergy(slotIndex: number) {
  const pattern = [0.78, 0.76, 0.55, 0.76, 0.88, 0.58, 0.86];
  return pattern[slotIndex % pattern.length];
}

function isMiddleThird(slotIndex: number, setLength: number) {
  if (setLength < 3) return true;
  const start = Math.floor(setLength / 3);
  const end = Math.ceil((setLength * 2) / 3) - 1;
  return slotIndex >= start && slotIndex <= end;
}

function ageOverlap(a: SongForSet | null, b: SongForSet) {
  if (!a?.audienceAgeAppeal?.length || !b.audienceAgeAppeal?.length) return false;
  const previous = new Set(a.audienceAgeAppeal);
  return b.audienceAgeAppeal.some((age) => previous.has(age));
}

function sameAgeRun(output: SongForSet[], candidate: SongForSet) {
  let count = 0;
  for (let i = output.length - 1; i >= 0; i--) {
    if (!ageOverlap(output[i], candidate)) break;
    count++;
  }
  return count;
}

function transitionNeedsFlex(candidate: SongForSet, previous: SongForSet | null) {
  if (!previous) return false;
  const bpmDiff = Math.abs(effectiveBpm(previous) - effectiveBpm(candidate));
  return bpmDiff > 18 || !sameText(candidate.genre, previous.genre) || !sameText(candidate.vibe, previous.vibe);
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
    const singalong = scoreValue(candidate.singalongScore, crowd);
    const peak = scoreValue(candidate.peakHourScore, Math.max(crowd, dance));
    const flex = scoreValue(candidate.transitionFlexibility);
    const female = scoreValue(candidate.femaleParticipationScore, dance);
    const vocal = scoreValue(candidate.vocalDifficulty, 0.35);
    const engagement = audienceEngagementScore(candidate);
    const strength = songStrength(candidate, options);
    const peakSong = peak >= 0.8;

    // Core curve: each slot has a target energy, so the set can breathe instead of sorting by title or BPM.
    let score = 8 - Math.abs(energy - desiredEnergy) * 5 - Math.abs(energy - targetPatternEnergy(slotIndex)) * 3;

    // Strategy weights nudge the same pool toward different practical live-show goals.
    if (options.strategy === "dance-heavy") score += dance * 2.2 + female * 1.5 + peak + crowd * 0.6;
    else if (options.strategy === "singalong-heavy") score += singalong * 2.6 + crowd * 1.4 + female * 0.8;
    else if (options.strategy === "acoustic-chill") score += (1 - energy) * 2 + crowd;
    else if (options.strategy === "high-energy") score += energy * 1.8 + peak * 1.4 + dance + female * 0.7;
    else score += engagement * 3 + energy * 0.8 + peak * 1.2 + flex * 0.5;

    // Openers should feel known and awake; closers should feel strong, familiar, and high-impact.
    if (firstSlot) score += (candidate.openerCandidate ? 10 : 0) + crowd * 2.4 + energy * 2.2 + engagement * 1.2 - (energy < 0.45 ? 6 : 0) - (engagement < 0.45 ? 4 : 0);
    if (finalSlot) score += (candidate.closerCandidate ? 11 : 0) + singalong * 3 + crowd * 2 + engagement * 1.5 + (["Singalong", "Intimate"].some((value) => sameText(candidate.vibe, value)) ? 2 : 0);

    if (peakSong) {
      score += isMiddleThird(slotIndex, setLength) ? 5 : -5;
      if (previous && scoreValue(previous.peakHourScore) >= 0.8) score -= 7;
    }

    // Saving the strongest material for later avoids burning all the big songs too early.
    if (options.saveStrongestForLater) score += strength * progress * 2.5 - strength * (1 - progress) * 0.75;

    if (previous) {
      const bpmDrop = effectiveBpm(previous) - effectiveBpm(candidate);
      const bpmDiff = Math.abs(effectiveBpm(previous) - effectiveBpm(candidate));
      score -= bpmDiff / 55;

      if (options.avoidSameArtist && sameText(candidate.artist, previous.artist)) score -= 7;
      if (options.avoidSameGenre && sameText(candidate.genre, previous.genre)) score -= 2.5;
      if (sameText(candidate.vibe, previous.vibe)) score -= 1.25;
      score += transitionNeedsFlex(candidate, previous) ? flex * 2.2 : flex * 0.6;
      if (options.avoidBigBpmDrops && !["acoustic-chill", "build-slowly"].includes(options.strategy) && bpmDrop > 18) score -= (bpmDrop - 18) / 4;
      if (options.avoidHardVocals && vocal >= 0.72 && scoreValue(previous.vocalDifficulty, 0.35) >= 0.72) score -= 6;
      if (options.avoidHardVocals && vocal >= 0.85) score -= 2;
      if (avoidsPrevious(candidate, previous)) score -= 10;
      if (sameAgeRun(output, candidate) >= 2) score -= 3.5;
    }

    // More than two lower-energy songs in a row can make a live room sag.
    if (energy < 0.45 && lowEnergyRun(output) >= 2) score -= 8;
    if (energy >= 0.72 && highEnergyRun(output) >= 3) score -= 7;

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

function explainSet(set: SongForSet[], setIndex: number) {
  const opener = set[0];
  const closer = set[set.length - 1];
  return {
    opener: opener ? {
      setIndex,
      songId: opener.id,
      title: opener.title,
      reasons: [
        opener.openerCandidate ? "Marked opener candidate" : null,
        `Energy ${Math.round(effectiveEnergy(opener) * 10)}/10`,
        `Crowd ${Math.round(scoreValue(opener.crowdScore) * 10)}/10`,
        `Engagement ${Math.round(audienceEngagementScore(opener) * 10)}/10`,
      ].filter((item): item is string => Boolean(item)),
    } : null,
    closer: closer ? {
      setIndex,
      songId: closer.id,
      title: closer.title,
      reasons: [
        closer.closerCandidate ? "Marked closer candidate" : null,
        `Singalong ${Math.round(scoreValue(closer.singalongScore, scoreValue(closer.crowdScore)) * 10)}/10`,
        `Crowd ${Math.round(scoreValue(closer.crowdScore) * 10)}/10`,
        sameText(closer.vibe, "Singalong") || sameText(closer.vibe, "Intimate") ? "Memorable ending vibe" : null,
      ].filter((item): item is string => Boolean(item)),
    } : null,
  };
}

export function explainBuiltSets(sets: SongForSet[][]): SetBuildExplanation {
  const allSongs = sets.flat();
  const setReasons = sets.map((set, index) => explainSet(set, index + 1));
  const ageCounts = new Map<string, number>();
  for (const song of allSongs) {
    for (const age of song.audienceAgeAppeal ?? []) {
      ageCounts.set(age, (ageCounts.get(age) ?? 0) + 1);
    }
  }
  const averageEngagementScore = allSongs.length
    ? Math.round((allSongs.reduce((sum, song) => sum + audienceEngagementScore(song), 0) / allSongs.length) * 10)
    : 0;
  const averageEnergyScore = allSongs.length
    ? Math.round((allSongs.reduce((sum, song) => sum + effectiveEnergy(song), 0) / allSongs.length) * 10)
    : 0;

  return {
    openerReasons: setReasons.map((item) => item.opener).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    closerReasons: setReasons.map((item) => item.closer).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    topEngagementSongs: [...allSongs]
      .sort((a, b) => audienceEngagementScore(b) - audienceEngagementScore(a))
      .slice(0, 8)
      .map((song) => ({ songId: song.id, title: song.title, score: Math.round(audienceEngagementScore(song) * 10) })),
    peakHourSongs: allSongs
      .filter((song) => scoreValue(song.peakHourScore) >= 0.8)
      .map((song) => ({ songId: song.id, title: song.title, score: Math.round(scoreValue(song.peakHourScore) * 10) })),
    energyFlowMoves: sets.flatMap((set, setIndex) => set.map((song, index) => {
      const energy = effectiveEnergy(song);
      const pattern = targetPatternEnergy(index);
      if (Math.abs(energy - pattern) <= 0.18) return null;
      return `Set ${setIndex + 1}: ${song.title} placed at slot ${index + 1} to balance energy flow despite ${Math.round(energy * 10)}/10 energy.`;
    }).filter((item): item is string => Boolean(item))).slice(0, 8),
    audienceAgeDistribution: [...ageCounts.entries()]
      .map(([age, count]) => ({ age, count }))
      .sort((a, b) => b.count - a.count || a.age.localeCompare(b.age)),
    averageEngagementScore,
    averageEnergyScore,
  };
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
