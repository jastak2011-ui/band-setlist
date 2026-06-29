import { z } from "zod";
import { AuthError, authErrorResponse, getAccessibleBandIds, privateJson, requireBandAccess, requireUser, type AuthUser } from "@/lib/auth";
import { parseOnSongArchive } from "@/lib/onsong-import";
import { findOrCreateSongs } from "@/lib/song-import";
import { query, transaction } from "@/lib/db";
import { newId } from "@/lib/ids";

const venueTypes = ["Bar Crowd", "Brewery", "Restaurant", "Outdoor", "Private Party", "Wedding", "Corporate Event"] as const;
const crowdSetups = ["Seated", "Standing", "Mixed"] as const;

const optionalText = z.preprocess((value) => value === "" ? null : value, z.string().trim().nullable().optional());
const bodySchema = z.object({
  title: optionalText,
  bandId: optionalText,
  venueId: optionalText,
  performanceDate: optionalText,
  venueType: z.preprocess((value) => value === "" ? null : value, z.enum(venueTypes).nullable().optional()),
  crowdSetup: z.preprocess((value) => value === "" ? null : value, z.enum(crowdSetups).nullable().optional()),
  startTime: z.preprocess((value) => value === "" ? null : value, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()),
  endTime: z.preprocess((value) => value === "" ? null : value, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()),
  matchExistingSongs: z.preprocess((value) => value !== "false", z.boolean()),
  importMissingSongs: z.preprocess((value) => value !== "false", z.boolean()),
  updateExistingSongMetadata: z.preprocess((value) => value === "true", z.boolean()),
  preserveBandSetlistMetadata: z.preprocess((value) => value !== "false", z.boolean()),
});

function basenameWithoutArchive(filename: string) {
  const clean = filename.split(/[\\/]/).pop() || "Imported OnSong Set";
  return clean.replace(/\.archive$/i, "").trim() || "Imported OnSong Set";
}

function timesAreValid(startTime: string | null | undefined, endTime: string | null | undefined) {
  return !startTime || !endTime || startTime !== endTime;
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

const identityFieldChecks = [
  ["onsongSongId", "onsong_song_id"],
  ["onsongFilepath", "filepath"],
  ["onsongHash", "hash"],
  ["onsongContent", "content"],
  ["onsongLyrics", "lyrics"],
] as const;

function missingIdentityFields(song: Record<string, unknown>) {
  return identityFieldChecks.filter(([field]) => !hasValue(song[field])).map(([, label]) => label);
}

async function resolveBandId(user: AuthUser, requestedBandId: string | null | undefined) {
  if (requestedBandId) {
    await requireBandAccess(user, requestedBandId);
    return requestedBandId;
  }
  if (user.role === "admin") return null;
  const accessibleBandIds = await getAccessibleBandIds(user);
  if (accessibleBandIds?.length === 1) return accessibleBandIds[0];
  throw new AuthError("Choose a band for this imported setlist.", 400);
}

async function resolveVenueId(venueId: string | null | undefined, venueType: string | null | undefined, crowdSetup: string | null | undefined) {
  if (!venueId) return null;
  if (venueId) {
    if (venueType !== undefined || crowdSetup !== undefined) {
      const updated = await query(
        "UPDATE venues SET venue_type = COALESCE($2, venue_type), crowd_setup = COALESCE($3, crowd_setup, 'Mixed'), updated_at = NOW() WHERE id = $1 RETURNING id",
        [venueId, venueType ?? null, crowdSetup ?? null],
      );
      if (!updated.rows[0]) throw new AuthError("Selected venue was not found.", 404);
    } else {
      const found = await query("SELECT id FROM venues WHERE id = $1", [venueId]);
      if (!found.rows[0]) throw new AuthError("Selected venue was not found.", 404);
    }
    return venueId;
  }
}

function performedAtFromDate(value: string | null | undefined) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00`) : null;
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return privateJson({ ok: false, error: "Choose an OnSong .archive file." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".archive")) return privateJson({ ok: false, error: "Only .archive files can be imported as OnSong sets." }, { status: 400 });

    const parsedBody = bodySchema.safeParse({
      title: form.get("title"),
      bandId: form.get("bandId"),
      venueId: form.get("venueId"),
      performanceDate: form.get("performanceDate"),
      venueType: form.get("venueType"),
      crowdSetup: form.get("crowdSetup"),
      startTime: form.get("startTime"),
      endTime: form.get("endTime"),
      matchExistingSongs: form.get("matchExistingSongs"),
      importMissingSongs: form.get("importMissingSongs"),
      updateExistingSongMetadata: form.get("updateExistingSongMetadata"),
      preserveBandSetlistMetadata: form.get("preserveBandSetlistMetadata"),
    });
    if (!parsedBody.success) return privateJson({ ok: false, error: parsedBody.error.flatten() }, { status: 400 });
    if (!timesAreValid(parsedBody.data.startTime, parsedBody.data.endTime)) {
      return privateJson({ ok: false, error: "Start Time and End Time cannot be the same." }, { status: 400 });
    }

    const archive = parseOnSongArchive(Buffer.from(await file.arrayBuffer()));
    if (archive.archiveType === "Single Song") {
      return privateJson({ ok: false, error: "This is a single-song OnSong archive. Import it from the Songs page." }, { status: 400 });
    }
    if (archive.archiveType !== "SongSet") {
      return privateJson({ ok: false, error: "Import OnSong Set requires an OnSong SongSet archive." }, { status: 400 });
    }
    if (archive.songs.length === 0) return privateJson({ ok: false, error: "No songs were found in this OnSong set archive." }, { status: 400 });

    const bandId = await resolveBandId(user, parsedBody.data.bandId ?? null);
    const venueId = await resolveVenueId(parsedBody.data.venueId ?? null, parsedBody.data.venueType ?? null, parsedBody.data.crowdSetup ?? null);
    const setlistTitle = parsedBody.data.title?.trim() || archive.title?.trim() || basenameWithoutArchive(file.name);
    const songResults = await findOrCreateSongs(archive.songs, {
      matchExisting: parsedBody.data.matchExistingSongs,
      importMissing: parsedBody.data.importMissingSongs,
      updateExistingMetadata: parsedBody.data.updateExistingSongMetadata,
      preserveBandSetlistMetadata: parsedBody.data.preserveBandSetlistMetadata,
    });
    const setlistSongResults = songResults.filter((result) => result.song);
    if (setlistSongResults.length === 0) {
      return privateJson({
        ok: false,
        error: "No songs could be included in the imported setlist. Turn on Match existing songs or Import missing songs and try again.",
        songsFound: archive.songs.length,
        skipped: songResults.filter((result) => result.status === "skipped").length,
      }, { status: 400 });
    }
    const setlistId = newId();

    await transaction(async (client) => {
      await client.query(
        `
        INSERT INTO setlists (id, venue_id, band_id, title, performed_at, start_time, end_time, created_at, updated_at, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8)
        `,
        [
          setlistId,
          venueId,
          bandId,
          setlistTitle,
          performedAtFromDate(parsedBody.data.performanceDate),
          parsedBody.data.startTime ?? null,
          parsedBody.data.endTime ?? null,
          `Imported from OnSong archive: ${file.name}`,
        ],
      );

      const setId = newId();
      await client.query(
        "INSERT INTO setlist_sets (id, setlist_id, set_index, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
        [setId, setlistId, 0],
      );
      for (const [index, result] of setlistSongResults.entries()) {
        if (!result.song) continue;
        await client.query(
          "INSERT INTO setlist_set_songs (id, set_id, song_id, position, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
          [newId(), setId, result.song.id, index],
        );
      }
    });

    const created = songResults.filter((result) => result.status === "created").length;
    const updated = songResults.filter((result) => result.status === "updated").length;
    const matched = songResults.filter((result) => result.status === "matched").length;
    const skipped = songResults.filter((result) => result.status === "skipped").length;
    const details = songResults.map((result, index) => {
      const missing = missingIdentityFields(result.input as Record<string, unknown>);
      return {
        row: index + 1,
        title: result.song?.title ?? result.input.title,
        artist: result.song?.artist ?? result.input.artist,
        status: result.status,
        linked: Boolean(result.song?.onsongSongId),
        reason: result.status === "created"
          ? "Created new song and included it in the imported setlist."
          : result.status === "updated"
            ? "Matched existing song and filled missing OnSong identity fields."
            : result.status === "skipped"
              ? result.reason ?? "Skipped."
              : "Matched existing song and reused it in the imported setlist.",
        missingIdentityFields: missing,
      };
    });

    return privateJson({
      ok: true,
      archiveType: archive.archiveType,
      songsFound: archive.songs.length,
      songsProcessed: archive.songs.length,
      created,
      matched,
      updated,
      skipped,
      rowIssues: skipped,
      errors: skipped > 0 ? [`${skipped} unmatched song${skipped === 1 ? "" : "s"} skipped.`] : [],
      details,
      setlistCreated: true,
      incomplete: skipped > 0,
      setlistId,
      setlistTitle,
      setCount: 1,
    }, { status: 201 });
  } catch (error) {
    try {
      return authErrorResponse(error);
    } catch {
      return privateJson({ ok: false, error: error instanceof Error ? error.message : "OnSong set import failed." }, { status: 500 });
    }
  }
}
