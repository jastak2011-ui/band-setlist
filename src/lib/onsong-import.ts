import { BplistObject, BplistReal, BplistUid, parseBinaryPlist } from "@/lib/bplist";
import type { SongImportInput } from "@/lib/song-import";

type ArchiveDictionary = { [key: string]: BplistObject };
export type OnSongArchiveType = "SongSet" | "Single Song" | "Unknown archive with songs";
export type ParsedOnSongArchive = {
  archiveType: OnSongArchiveType;
  songs: SongImportInput[];
};

function isUid(value: BplistObject | undefined): value is BplistUid {
  const candidate = value as unknown as Partial<BplistUid>;
  return value instanceof BplistUid || Boolean(value && typeof value === "object" && candidate.kind === "uid" && Number.isInteger(candidate.value));
}

function isReal(value: BplistObject | undefined): value is BplistReal {
  const candidate = value as unknown as Partial<BplistReal>;
  return value instanceof BplistReal || Boolean(value && typeof value === "object" && candidate.kind === "real" && typeof candidate.value === "number");
}

function isDictionary(value: BplistObject | undefined): value is ArchiveDictionary {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !isUid(value) && !isReal(value);
}

function deref(objects: BplistObject[], value: BplistObject | undefined): BplistObject | undefined {
  if (isUid(value) && value.value === 0) return undefined;
  return isUid(value) ? objects[value.value] : value;
}

function stringValue(objects: BplistObject[], value: BplistObject | undefined) {
  const resolved = deref(objects, value);
  if (typeof resolved === "string") return resolved;
  if (isDictionary(resolved) && typeof resolved["NS.string"] === "string") return resolved["NS.string"];
  return null;
}

function numberValue(objects: BplistObject[], value: BplistObject | undefined) {
  const resolved = deref(objects, value);
  if (typeof resolved === "number") return Number.isFinite(resolved) ? resolved : null;
  if (isReal(resolved)) return Number.isFinite(resolved.value) ? resolved.value : null;
  return null;
}

function className(objects: BplistObject[], value: BplistObject | undefined) {
  const resolved = deref(objects, value);
  if (!isDictionary(resolved) || !isUid(resolved.$class)) return null;
  const classObject = objects[resolved.$class.value];
  return isDictionary(classObject) && typeof classObject.$classname === "string" ? classObject.$classname : null;
}

function plainContent(text: string | null) {
  if (!text) return null;
  return text
    .replace(/^\{t:[^}]*\}\s*/gim, "")
    .replace(/^\{st:[^}]*\}\s*/gim, "")
    .trim() || null;
}

function titleFromSong(objects: BplistObject[], song: ArchiveDictionary) {
  return stringValue(objects, song.title)
    ?? stringValue(objects, song.sortTitle)
    ?? stringValue(objects, song.filepath)?.replace(/\.(onsong|txt)$/i, "").split(" - ").pop()
    ?? "Untitled";
}

function artistFromSong(objects: BplistObject[], song: ArchiveDictionary) {
  return stringValue(objects, song.byline) ?? "Unknown Artist";
}

function songFromArchivedObject(objects: BplistObject[], song: BplistObject | undefined): SongImportInput | null {
  if (!isDictionary(song) || className(objects, song) !== "Song") return null;

  const content = stringValue(objects, song.content);
  const lyrics = stringValue(objects, song.lyrics);
  const hash = numberValue(objects, song.hash);
  const tempo = numberValue(objects, song.tempo);
  const duration = numberValue(objects, song.duration);

  return {
    title: titleFromSong(objects, song).trim(),
    artist: artistFromSong(objects, song).trim() || "Unknown Artist",
    bpm: tempo == null ? null : Math.trunc(tempo),
    musicalKey: stringValue(objects, song.key) || null,
    durationSec: duration == null ? null : Math.trunc(duration),
    notes: plainContent(content),
    onsongSongId: stringValue(objects, song.ID),
    onsongFilepath: stringValue(objects, song.filepath),
    onsongHash: hash == null ? null : Math.trunc(hash),
    onsongContent: content,
    onsongLyrics: lyrics,
    onsongUser: stringValue(objects, song.user),
    onsongProviderName: stringValue(objects, song.providerName),
    onsongProviderUri: stringValue(objects, song.providerUri),
  };
}

function songsFromSongSet(objects: BplistObject[], root: ArchiveDictionary) {
  const collection = deref(objects, root.songs);
  const itemArray = deref(objects, isDictionary(collection) ? collection.collection : undefined);
  const itemRefs = isDictionary(itemArray) && Array.isArray(itemArray["NS.objects"]) ? itemArray["NS.objects"] : [];

  return itemRefs
    .map((itemRef) => deref(objects, itemRef))
    .map((item) => deref(objects, isDictionary(item) ? item.song : undefined))
    .map((song) => songFromArchivedObject(objects, song))
    .filter((song): song is SongImportInput => Boolean(song?.title));
}

function scanSongObjects(objects: BplistObject[]) {
  const seen = new Set<string>();
  const songs: SongImportInput[] = [];
  for (const object of objects) {
    const song = songFromArchivedObject(objects, object);
    if (!song?.title) continue;
    const key = `${song.onsongSongId ?? ""}::${song.title.toLowerCase()}::${song.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(song);
  }
  return songs;
}

export function parseOnSongArchive(buffer: Buffer): ParsedOnSongArchive {
  if (buffer.subarray(0, 8).toString("ascii") !== "bplist00") throw new Error("Not an OnSong archive.");
  const archive = parseBinaryPlist(buffer);
  if (!isDictionary(archive) || archive.$archiver !== "NSKeyedArchiver") throw new Error("Not an OnSong NSKeyedArchiver archive.");

  const objects = Array.isArray(archive.$objects) ? archive.$objects : [];
  const root = deref(objects, isDictionary(archive.$top) ? archive.$top.root : undefined);
  const rootClass = className(objects, root);
  if (isDictionary(root) && rootClass === "SongSet") {
    return { archiveType: "SongSet", songs: songsFromSongSet(objects, root) };
  }
  if (isDictionary(root) && rootClass === "Song") {
    const song = songFromArchivedObject(objects, root);
    return { archiveType: "Single Song", songs: song?.title ? [song] : [] };
  }

  const songs = scanSongObjects(objects);
  if (songs.length === 0) throw new Error("Unsupported OnSong archive: no Song objects found.");
  return { archiveType: "Unknown archive with songs", songs };
}

export function parseOnSongArchiveSongs(buffer: Buffer): SongImportInput[] {
  return parseOnSongArchive(buffer).songs;
}
