import { BplistUid, writeBinaryPlist } from "@/lib/bplist";
import type { DbSong, DbSetlist } from "@/lib/db";

type OnSongSetlist = DbSetlist & {
  venueName?: string | null;
  bandName?: string | null;
};

type OnSongSet = {
  index: number;
  songs: DbSong[];
};

type ArchiveObject = Record<string, unknown>;

const NULL = new BplistUid(0);
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;

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

function secondsSinceAppleEpoch(date: Date) {
  return date.getTime() / 1000 - APPLE_EPOCH_OFFSET_SECONDS;
}

function songContent(song: DbSong) {
  const lines = [`{t:${song.title}}`, `{st:${song.artist}}`];
  if (song.bpm != null) lines.push(`BPM: ${song.bpm}`);
  if (song.musicalKey) lines.push(`Key: ${song.musicalKey}`);
  if (song.durationSec != null) lines.push(`Duration: ${song.durationSec}s`);
  if (song.notes) lines.push("", "Notes:", song.notes);
  return lines.join("\n");
}

function addClass(objects: ArchiveObject[], classname: string, classes: string[]) {
  objects.push({ "$classes": classes, "$classname": classname });
  return objects.length - 1;
}

function addDate(objects: ArchiveObject[], date: Date, dateClassIndex: number) {
  objects.push({ "NS.time": secondsSinceAppleEpoch(date), "$class": new BplistUid(dateClassIndex) });
  return objects.length - 1;
}

function makeSongObject(song: DbSong, songId: string, nowDateUid: BplistUid, songClassIndex: number) {
  const key = song.musicalKey?.trim() || null;
  const content = songContent(song);
  const titleAlpha = alpha(song.title);
  return {
    metadataFontSize: 14,
    ID: songId,
    user: "Band Setlist",
    key: key ?? NULL,
    lastPlayedOn: nowDateUid,
    headerFontColor: NULL,
    favorite: NULL,
    flow: NULL,
    showMetadata: true,
    showLyrics: true,
    iconName: NULL,
    favoriteColor: NULL,
    showCapoedChords: 0,
    created: nowDateUid,
    bylineAlpha: alpha(song.artist),
    zoomScale: 1,
    fontName: "Helvetica",
    notes: NULL,
    title: song.title,
    sortTitle: sortTitle(song.title),
    headerFontSize: 21,
    viewed: nowDateUid,
    chordStyle: 0,
    copyright: NULL,
    filepath: `${song.artist} - ${song.title}.onsong`,
    fontColor: NULL,
    ccli: NULL,
    capo: NULL,
    syncTimestamp: nowDateUid,
    metadataFontName: "Helvetica",
    headerFontName: "Helvetica-Bold",
    showTablature: false,
    monospacedFontSize: 14,
    zoomPointX: 0,
    diagramPosition: 0,
    highlightOpaque: true,
    providerName: "Band Setlist",
    monospacedFontColor: NULL,
    monospacedFontName: "Courier",
    beatsPerLine: 6,
    zoomPointY: 0,
    showNotes: true,
    tempo: song.bpm ?? NULL,
    showTitle: true,
    highlightColor: NULL,
    deleted: 0,
    loaned: 0,
    usefile: 0,
    instructionsFontColor: "555555",
    metadataFontColor: NULL,
    lyrics: content,
    timeSignature: NULL,
    subdivision: NULL,
    providerUri: NULL,
    showExpanded: true,
    hash: Math.abs([...song.id].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0)),
    showSectionLabels: true,
    byline: song.artist,
    duration: song.durationSec ?? NULL,
    number: NULL,
    alphaStripped: titleAlpha,
    chordFontColor: NULL,
    chordPosition: 0,
    showChords: true,
    lineSpacing: 1,
    content,
    pitch: NULL,
    chordFontSize: 14,
    mediaID: NULL,
    modified: nowDateUid,
    alpha: titleAlpha,
    imported: 1,
    lastImportedOn: nowDateUid,
    tablatureSize: 0.16665999591350555,
    performTransposition: false,
    keywords: NULL,
    chordFontName: "Helvetica",
    transposedKey: key ?? NULL,
    adjustForCapo: false,
    language: "en",
    instrument: "guitar",
    sortTitleStripped: sortTitle(song.title),
    fontSize: 14,
    "$class": new BplistUid(songClassIndex),
  };
}

export function createOnSongArchive(setlist: OnSongSetlist, sets: OnSongSet[]) {
  const now = new Date();
  const performanceDate = setlist.performedAt ?? setlist.createdAt ?? now;
  const flatSongs = sets.flatMap((set) => set.songs);
  const objects: ArchiveObject[] = ["$null"] as unknown as ArchiveObject[];

  objects.push({});
  const setIndex = objects.length - 1;
  objects.push({});
  const collectionIndex = objects.length - 1;
  objects.push({});
  const mutableArrayIndex = objects.length - 1;

  const songClassIndex = addClass(objects, "Song", ["Song", "NSObject"]);
  const itemClassIndex = addClass(objects, "SongSetItem", ["SongSetItem", "NSObject"]);
  const mutableArrayClassIndex = addClass(objects, "NSMutableArray", ["NSMutableArray", "NSArray", "NSObject"]);
  const collectionClassIndex = addClass(objects, "SongSetItemCollection", ["SongSetItemCollection", "OSCollection", "NSObject"]);
  const dateClassIndex = addClass(objects, "NSDate", ["NSDate", "NSObject"]);
  const setClassIndex = addClass(objects, "SongSet", ["SongSet", "NSObject"]);
  const dateUid = new BplistUid(addDate(objects, performanceDate, dateClassIndex));
  const setId = uuidFromSongId(setlist.id, 0);

  const itemUids: BplistUid[] = [];
  flatSongs.forEach((song, index) => {
    const songId = uuidFromSongId(song.id, index + 1);
    const itemId = JSON.stringify({ setID: setId, songID: songId, orderIndex: index });
    objects.push(makeSongObject(song, songId, dateUid, songClassIndex));
    const songObjectIndex = objects.length - 1;
    objects.push({
      songID: songId,
      bookID: NULL,
      orderIndex: index,
      setID: setId,
      song: new BplistUid(songObjectIndex),
      ID: itemId,
      "$class": new BplistUid(itemClassIndex),
    });
    itemUids.push(new BplistUid(objects.length - 1));
  });

  objects[mutableArrayIndex] = {
    "NS.objects": itemUids,
    "$class": new BplistUid(mutableArrayClassIndex),
  };
  objects[collectionIndex] = {
    collection: new BplistUid(mutableArrayIndex),
    "$class": new BplistUid(collectionClassIndex),
    class: "SongSetItem",
    index: NULL,
  };
  objects[setIndex] = {
    modified: NULL,
    playbackContinuity: 0,
    useSeparateStyles: NULL,
    title: setlist.title || [setlist.bandName, setlist.venueName].filter(Boolean).join(" - ") || "Band Setlist",
    unarchived: NULL,
    summary: NULL,
    "$class": new BplistUid(setClassIndex),
    songs: new BplistUid(collectionIndex),
    archived: NULL,
    providerName: "Band Setlist",
    sceneID: NULL,
    orderDirection: 0,
    datetime: dateUid,
    quantity: flatSongs.length,
    orderMethod: "orderIndex",
    user: NULL,
    providerUri: NULL,
    expires: NULL,
    ID: setId,
    hasTime: false,
    created: dateUid,
    orderIndex: NULL,
  };

  const archive = {
    "$version": 100000,
    "$archiver": "NSKeyedArchiver",
    "$top": { root: new BplistUid(setIndex) },
    "$objects": objects as never,
  };

  return writeBinaryPlist(archive as never);
}

export function onSongArchiveFilename(setlist: OnSongSetlist) {
  const band = setlist.bandName?.trim() || "Band Setlist";
  const venue = setlist.venueName?.trim() || "Setlist";
  const date = (setlist.performedAt ?? setlist.createdAt ?? new Date()).toISOString().slice(0, 10);
  return `${band} - ${venue} - ${date} - OnSong.archive`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
}
