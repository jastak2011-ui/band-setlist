import { z } from "zod";

export const audienceAgeAppealValues = ["Boomer", "Gen X", "Millennial", "Gen Z", "All Ages"] as const;

export type AudienceAgeAppeal = (typeof audienceAgeAppealValues)[number];

export const audienceAgeAppealSchema = z.enum(audienceAgeAppealValues, {
  message: `Audience age appeal must be one of: ${audienceAgeAppealValues.join(", ")}.`,
});

export const audienceAgeAppealArraySchema = z.array(audienceAgeAppealSchema);

const allowedAudienceAgeAppeal = new Set<string>(audienceAgeAppealValues);

export function isAudienceAgeAppeal(value: string): value is AudienceAgeAppeal {
  return allowedAudienceAgeAppeal.has(value);
}

export function filterAudienceAgeAppeal(values: string[] | null | undefined) {
  if (!values) return null;
  const filtered = values.filter(isAudienceAgeAppeal);
  return filtered.length ? filtered : null;
}
