import { z } from "zod";
import { authErrorResponse, privateJson, requireUser } from "@/lib/auth";
import { parseOnSongArchive } from "@/lib/onsong-import";
import { findOrCreateSongs } from "@/lib/song-import";

const bodySchema = z.object({
  importMissingSongs: z.preprocess((value) => value === "true", z.boolean()),
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return privateJson({ ok: false, error: "Choose an OnSong .archive file." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".archive")) {
      return privateJson({ ok: false, error: "Only .archive files can be imported as OnSong sets." }, { status: 400 });
    }

    const parsed = bodySchema.safeParse({ importMissingSongs: form.get("importMissingSongs") });
    if (!parsed.success) return privateJson({ ok: false, error: parsed.error.flatten() }, { status: 400 });

    const archive = parseOnSongArchive(Buffer.from(await file.arrayBuffer()));
    if (archive.archiveType === "Single Song") {
      return privateJson({ ok: false, error: "This is a single-song OnSong archive. Import it from the Songs page." }, { status: 400 });
    }
    if (archive.archiveType !== "SongSet") {
      return privateJson({ ok: false, error: "Set Builder import requires an OnSong SongSet archive." }, { status: 400 });
    }
    if (archive.songs.length === 0) return privateJson({ ok: false, error: "No songs were found in this OnSong set archive." }, { status: 400 });

    const results = await findOrCreateSongs(archive.songs, {
      matchExisting: true,
      importMissing: parsed.data.importMissingSongs,
      updateExistingMetadata: false,
      preserveBandSetlistMetadata: true,
    });
    const resultByInput = new Map(results.map((result) => [result.input, result]));
    const sourceSets = archive.sets?.length ? archive.sets : [archive.songs];
    const sets = sourceSets.map((sourceSet, setIndex) => ({
      index: setIndex + 1,
      songs: sourceSet.flatMap((input, position) => {
        const result = resultByInput.get(input);
        if (!result?.song) return [];
        return [{
          ...result.song,
          position: position + 1,
        }];
      }),
    })).filter((set) => set.songs.length > 0).map((set, index) => ({
      ...set,
      index: index + 1,
      songs: set.songs.map((song, position) => ({ ...song, position: position + 1 })),
    }));

    const details = results.map((result, index) => ({
      row: index + 1,
      title: result.song?.title ?? result.input.title,
      artist: result.song?.artist ?? result.input.artist,
      status: result.status,
      reason: result.reason ?? (result.status === "created" ? "Created in the song library." : result.status === "updated" ? "Filled missing OnSong identity fields." : "Matched and reused existing library song."),
    }));
    const created = results.filter((result) => result.status === "created").length;
    const matched = results.filter((result) => result.status === "matched").length;
    const updated = results.filter((result) => result.status === "updated").length;
    const skipped = results.filter((result) => result.status === "skipped").length;

    if (sets.length === 0) {
      return privateJson({
        ok: false,
        error: "No archive songs could be added to the builder. Turn on Import missing songs and try again.",
        songsProcessed: archive.songs.length,
        created,
        matched,
        updated,
        skipped,
        details,
      }, { status: 400 });
    }

    return privateJson({
      ok: true,
      title: archive.title ?? null,
      songsProcessed: archive.songs.length,
      created,
      matched,
      updated,
      skipped,
      errors: skipped ? [`${skipped} unmatched song${skipped === 1 ? "" : "s"} skipped.`] : [],
      sets,
      details,
    });
  } catch (error) {
    try {
      return authErrorResponse(error);
    } catch {
      return privateJson({ ok: false, error: error instanceof Error ? error.message : "OnSong archive import failed." }, { status: 500 });
    }
  }
}
