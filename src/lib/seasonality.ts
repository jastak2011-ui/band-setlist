const HOLIDAY_GENRE_PATTERN = /\b(holiday|christmas|xmas|seasonal|christmas music)\b/i;

export type SeasonalSongLike = {
  id: string;
  title: string;
  genre?: string | null;
};

export function isHolidayGenre(genre: string | null | undefined) {
  return HOLIDAY_GENRE_PATTERN.test(genre ?? "");
}

export function isHolidayActiveDate(value: string | Date | null | undefined) {
  if (!value) return false;
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T12:00:00`) : value;
  if (Number.isNaN(date.getTime())) return false;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return month === 12 || (month === 11 && day >= 15);
}

export function holidaySongsOutsideSeason<T extends SeasonalSongLike>(songs: T[], performanceDate: string | Date | null | undefined) {
  if (!performanceDate) return [];
  if (isHolidayActiveDate(performanceDate)) return [];
  return songs.filter((song) => isHolidayGenre(song.genre));
}
