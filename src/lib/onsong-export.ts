import fs from "node:fs";
import path from "node:path";

import { BplistData, BplistObject, BplistReal, BplistUid, parseBinaryPlist, writeBinaryPlist } from "@/lib/bplist";
import type { DbSong, DbSetlist } from "@/lib/db";

type OnSongSetlist = DbSetlist & {
  venueName?: string | null;
  bandName?: string | null;
};

type OnSongSet = {
  index: number;
  songs: DbSong[];
};

type ArchiveDictionary = { [key: string]: BplistObject };
type SegmentCopy = {
  map: Map<number, number>;
  itemIndex: number;
  songIndex: number;
};
type PendingObject = {
  source: BplistObject;
  localMap?: Map<number, number>;
};

const NULL = new BplistUid(0);
const TEMPLATE_ARCHIVE_PATH = path.join(process.cwd(), "public", "onsong-template.archive");

let cachedTemplate: ArchiveDictionary | null = null;

function uuidFromSongId(songId: string, index: number) {
  const normalized = songId.replace(/[^a-f0-9]/gi, "").padEnd(32, String(index % 10)).slice(0, 32).toUpperCase();
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function alpha(value: string) {
  const match = value.trim().match(/[a-z0-9]/i);
  return (match?.[0] ?? "#").toUpperCase();
}

function sortTitle(value: string) {
  return value.replace(/^(the|a|an)\s+/i, "").toUpperCase();
}

function songContent(song: DbSong) {
  const lines = [`{t:${song.title}}`, `{st:${song.artist}}`];
  if (song.bpm != null) lines.push(`BPM: ${song.bpm}`);
  if (song.musicalKey) lines.push(`Key: ${song.musicalKey}`);
  if (song.durationSec != null) lines.push(`Duration: ${song.durationSec}s`);
  if (song.notes) lines.push("", "Notes:", song.notes);
  return lines.join("\n");
}

function generatedSongHash(song: DbSong) {
  return Math.abs([...song.id].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0));
}

function preservedHash(song: DbSong) {
  if (!song.onsongHash) return null;
  const value = Number(song.onsongHash);
  return Number.isSafeInteger(value) ? value : null;
}

function isUid(value: BplistObject | undefined): value is BplistUid {
  const candidate = value as unknown as Partial<BplistUid>;
  return value instanceof BplistUid || Boolean(value && typeof value === "object" && candidate.kind === "uid" && Number.isInteger(candidate.value));
}

function isDictionary(value: BplistObject | undefined): value is ArchiveDictionary {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof BplistUid) && !(value instanceof BplistData) && !(value instanceof BplistReal);
}

function isData(value: BplistObject): value is BplistData {
  const candidate = value as unknown as Partial<BplistData>;
  return value instanceof BplistData || Boolean(value && typeof value === "object" && candidate.kind === "data" && Buffer.isBuffer(candidate.value));
}

function isReal(value: BplistObject): value is BplistReal {
  const candidate = value as unknown as Partial<BplistReal>;
  return value instanceof BplistReal || Boolean(value && typeof value === "object" && candidate.kind === "real" && typeof candidate.value === "number");
}

function asDictionary(value: BplistObject | undefined, label: string): ArchiveDictionary {
  if (!isDictionary(value)) throw new Error(`Invalid OnSong template: ${label} is not a dictionary.`);
  return value;
}

function asObjectArray(value: BplistObject | undefined, label: string): BplistObject[] {
  if (!Array.isArray(value)) throw new Error(`Invalid OnSong template: ${label} is not an array.`);
  return value;
}

function templateArchive() {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = asDictionary(parseBinaryPlist(fs.readFileSync(TEMPLATE_ARCHIVE_PATH)), "archive root");
  return cachedTemplate;
}

function cloneValue(value: BplistObject, remapUid: (uid: number) => number): BplistObject {
  if (value instanceof BplistUid || isUid(value)) return new BplistUid(remapUid(value.value));
  if (isData(value)) return new BplistData(Buffer.from(value.value));
  if (isReal(value)) return new BplistReal(value.value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map((item) => cloneValue(item, remapUid));
  if (isDictionary(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child, remapUid)]));
  }
  return value;
}

function deref(objects: BplistObject[], value: BplistObject | undefined) {
  return isUid(value) ? objects[value.value] : value;
}

function addObject(objects: BplistObject[], value: BplistObject) {
  objects.push(value);
  return new BplistUid(objects.length - 1);
}

function setArchivedString(objects: BplistObject[], owner: ArchiveDictionary, field: string, value: string) {
  const current = owner[field];
  if (!isUid(current)) {
    owner[field] = addObject(objects, value);
    return;
  }

  const target = objects[current.value];
  if (typeof target === "string") {
    objects[current.value] = value;
  } else if (isDictionary(target) && "NS.string" in target) {
    target["NS.string"] = value;
  } else {
    owner[field] = addObject(objects, value);
  }
}

function setArchivedNullableString(objects: BplistObject[], owner: ArchiveDictionary, field: string, value: string | null | undefined) {
  if (value == null || value.trim() === "") owner[field] = NULL;
  else setArchivedString(objects, owner, field, value);
}

function setArchivedNumber(objects: BplistObject[], owner: ArchiveDictionary, field: string, value: number) {
  owner[field] = addObject(objects, value);
}

function templateItemIndexes(objects: BplistObject[]) {
  const root = asDictionary(objects[1], "SongSet");
  const collection = asDictionary(deref(objects, root.songs), "SongSetItemCollection");
  const itemArray = asDictionary(deref(objects, asDictionary(collection, "SongSetItemCollection").collection), "SongSetItem array");
  const itemUids = asObjectArray(itemArray["NS.objects"], "SongSetItem array objects");
  return itemUids.map((item) => {
    if (!isUid(item)) throw new Error("Invalid OnSong template: SongSetItem array contains a non-UID.");
    return item.value;
  });
}

function segmentRanges(objects: BplistObject[], itemIndexes: number[]) {
  const tailStart = objects.findIndex(
    (object, index) => index > itemIndexes[itemIndexes.length - 1] && isDictionary(object) && object.$classname === "NSMutableArray",
  );
  if (tailStart < 0) throw new Error("Invalid OnSong template: could not locate class dictionary tail.");
  return itemIndexes.map((start, index) => ({
    start,
    end: index + 1 < itemIndexes.length ? itemIndexes[index + 1] : tailStart,
  }));
}

function copyRange(pending: PendingObject[], sourceObjects: BplistObject[], start: number, end: number, sharedMap: Map<number, number>, localMap?: Map<number, number>) {
  for (let sourceIndex = start; sourceIndex < end; sourceIndex++) {
    const newIndex = pending.length;
    pending.push({ source: sourceObjects[sourceIndex], localMap });
    if (localMap) localMap.set(sourceIndex, newIndex);
    else sharedMap.set(sourceIndex, newIndex);
  }
}

function buildTemplateObjects(sourceObjects: BplistObject[], songCount: number) {
  const itemIndexes = templateItemIndexes(sourceObjects);
  const ranges = segmentRanges(sourceObjects, itemIndexes);
  const tailStart = ranges[ranges.length - 1].end;
  const pending: PendingObject[] = [];
  const sharedMap = new Map<number, number>();
  const segmentCopies: SegmentCopy[] = [];

  copyRange(pending, sourceObjects, 0, ranges[0].start, sharedMap);

  for (let songIndex = 0; songIndex < songCount; songIndex++) {
    const templateRange = ranges[songIndex] ?? ranges[1] ?? ranges[0];
    const localMap = new Map<number, number>();
    copyRange(pending, sourceObjects, templateRange.start, templateRange.end, sharedMap, localMap);
    for (const [oldIndex, newIndex] of localMap) {
      if (!sharedMap.has(oldIndex)) sharedMap.set(oldIndex, newIndex);
    }

    const templateItem = asDictionary(sourceObjects[templateRange.start], "SongSetItem template");
    const templateSong = isUid(templateItem.song) ? templateItem.song.value : null;
    const songCopyIndex = templateSong == null ? null : localMap.get(templateSong);
    if (songCopyIndex == null) throw new Error("Invalid OnSong template: SongSetItem does not point to a Song.");
    segmentCopies.push({ map: localMap, itemIndex: localMap.get(templateRange.start) ?? pending.length - 1, songIndex: songCopyIndex });
  }

  copyRange(pending, sourceObjects, tailStart, sourceObjects.length, sharedMap);

  const remappedObjects = pending.map(({ source, localMap }) =>
    cloneValue(source, (uid) => localMap?.get(uid) ?? sharedMap.get(uid) ?? uid),
  );

  return { objects: remappedObjects, sharedMap, segmentCopies };
}

function updateSong(objects: BplistObject[], songObjectIndex: number, itemObjectIndex: number, song: DbSong, songIndex: number, setId: string) {
  const songObject = asDictionary(objects[songObjectIndex], `Song ${songIndex}`);
  const itemObject = asDictionary(objects[itemObjectIndex], `SongSetItem ${songIndex}`);
  const title = song.title || "Untitled";
  const artist = song.artist || "";
  const titleSort = sortTitle(title);
  const titleAlpha = alpha(title);
  const songId = song.onsongSongId || uuidFromSongId(song.id, songIndex + 1);
  const content = song.onsongContent || song.onsongLyrics || songContent({ ...song, title, artist });
  const lyrics = song.onsongLyrics || song.onsongContent || content;
  const filepath = song.onsongFilepath || `${artist} - ${title}.onsong`;
  const hash = preservedHash(song) ?? generatedSongHash(song);
  const itemId = JSON.stringify({ setID: setId, songID: songId, orderIndex: songIndex });

  setArchivedString(objects, songObject, "ID", songId);
  setArchivedString(objects, songObject, "title", title);
  setArchivedString(objects, songObject, "sortTitle", titleSort);
  setArchivedString(objects, songObject, "sortTitleStripped", titleSort);
  setArchivedString(objects, songObject, "alpha", titleAlpha);
  setArchivedString(objects, songObject, "alphaStripped", titleAlpha);
  setArchivedString(objects, songObject, "byline", artist);
  setArchivedString(objects, songObject, "bylineAlpha", alpha(artist));
  setArchivedString(objects, songObject, "content", content);
  setArchivedString(objects, songObject, "lyrics", lyrics);
  setArchivedString(objects, songObject, "filepath", filepath);
  setArchivedString(objects, songObject, "key", song.musicalKey?.trim() ?? "");
  setArchivedString(objects, songObject, "transposedKey", song.musicalKey?.trim() ?? "");
  setArchivedNumber(objects, songObject, "hash", hash);
  setArchivedString(objects, songObject, "user", song.onsongUser || "Band Setlist");
  setArchivedNullableString(objects, songObject, "providerName", song.onsongProviderName);
  setArchivedNullableString(objects, songObject, "providerUri", song.onsongProviderUri);
  songObject.tempo = NULL;
  songObject.duration = NULL;

  setArchivedString(objects, itemObject, "songID", songId);
  setArchivedString(objects, itemObject, "setID", setId);
  setArchivedString(objects, itemObject, "ID", itemId);
  setArchivedNumber(objects, itemObject, "orderIndex", songIndex);
}

function cloneArchiveRoot(templateRoot: ArchiveDictionary, objects: BplistObject[], rootIndex: number) {
  const archive = cloneValue(templateRoot, (uid) => uid) as ArchiveDictionary;
  archive["$objects"] = objects;
  const top = asDictionary(archive["$top"], "archive top");
  top.root = new BplistUid(rootIndex);
  return archive;
}

export function createOnSongArchive(setlist: OnSongSetlist, sets: OnSongSet[]) {
  const templateRoot = templateArchive();
  const sourceObjects = asObjectArray(templateRoot["$objects"], "template objects");
  const flatSongs = sets.flatMap((set) => set.songs);
  const title = setlist.title || [setlist.bandName, setlist.venueName].filter(Boolean).join(" - ") || "Band Setlist";
  const setId = uuidFromSongId(setlist.id, 0);
  const { objects, sharedMap, segmentCopies } = buildTemplateObjects(sourceObjects, flatSongs.length);

  const rootIndex = sharedMap.get(1);
  const collectionIndex = sharedMap.get(2);
  const arrayIndex = sharedMap.get(4);
  if (rootIndex == null || collectionIndex == null || arrayIndex == null) throw new Error("Invalid OnSong template clone.");

  const root = asDictionary(objects[rootIndex], "SongSet");
  const collection = asDictionary(objects[collectionIndex], "SongSetItemCollection");
  const itemArray = asDictionary(objects[arrayIndex], "SongSetItem array");
  setArchivedString(objects, root, "title", title);
  collection.collection = new BplistUid(arrayIndex);
  itemArray["NS.objects"] = segmentCopies.map((copy) => new BplistUid(copy.itemIndex));

  flatSongs.forEach((song, index) => {
    const copy = segmentCopies[index];
    updateSong(objects, copy.songIndex, copy.itemIndex, song, index, setId);
  });

  return writeBinaryPlist(cloneArchiveRoot(templateRoot, objects, rootIndex));
}

export function onSongArchiveFilename(setlist: OnSongSetlist) {
  const band = setlist.bandName?.trim() || "Band Setlist";
  const venue = setlist.venueName?.trim() || "Setlist";
  const date = (setlist.performedAt ?? setlist.createdAt ?? new Date()).toISOString().slice(0, 10);
  return `${band} - ${venue} - ${date} - OnSong.archive`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
}
