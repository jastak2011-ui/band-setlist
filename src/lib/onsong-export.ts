import { BplistData, BplistReal, BplistUid, writeBinaryPlist } from "@/lib/bplist";
import type { DbSong, DbSetlist } from "@/lib/db";

type OnSongSetlist = DbSetlist & {
  venueName?: string | null;
  bandName?: string | null;
};

type OnSongSet = {
  index: number;
  songs: DbSong[];
};

type ClassName =
  | "NSDictionary"
  | "NSArray"
  | "NSMutableDictionary"
  | "UIColor"
  | "NSDate"
  | "NSMutableString"
  | "Song"
  | "SongSetItem"
  | "NSMutableArray"
  | "SongSetItemCollection"
  | "SongSet";

type ClassRef = { kind: "classRef"; name: ClassName };
type ArchiveValue = unknown;

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

function isPlainObject(value: unknown): value is Record<string, ArchiveValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof BplistUid) && !(value instanceof BplistData) && !(value instanceof BplistReal);
}

class ArchiveBuilder {
  objects: ArchiveValue[] = ["$null"];
  classIndexes = new Map<ClassName, number>();

  reserve() {
    this.objects.push(null);
    return this.objects.length - 1;
  }

  uid(index: number) {
    return new BplistUid(index);
  }

  set(index: number, value: ArchiveValue) {
    this.objects[index] = value;
    return this.uid(index);
  }

  add(value: ArchiveValue) {
    this.objects.push(value);
    return this.uid(this.objects.length - 1);
  }

  string(value: string | null | undefined) {
    return value == null ? NULL : this.add(value);
  }

  number(value: number | null | undefined) {
    return value == null || Number.isNaN(value) ? NULL : this.add(value);
  }

  real(value: number | null | undefined) {
    return value == null || Number.isNaN(value) ? NULL : this.add(new BplistReal(value));
  }

  date(value: Date) {
    return this.add({ "NS.time": secondsSinceAppleEpoch(value), "$class": this.classRef("NSDate") });
  }

  classRef(name: ClassName): ClassRef {
    return { kind: "classRef", name };
  }

  addClass(name: ClassName, classes: string[], classHints?: string[]) {
    this.classIndexes.set(name, this.objects.length);
    this.objects.push(classHints ? { "$classhints": classHints, "$classes": classes, "$classname": name } : { "$classes": classes, "$classname": name });
  }

  addClassDictionaries() {
    this.addClass("NSDictionary", ["NSDictionary", "NSObject"]);
    this.addClass("NSArray", ["NSArray", "NSObject"]);
    this.addClass("NSMutableDictionary", ["NSMutableDictionary", "NSDictionary", "NSObject"]);
    this.addClass("UIColor", ["UIColor", "NSObject"], ["NSColor"]);
    this.addClass("NSDate", ["NSDate", "NSObject"]);
    this.addClass("NSMutableString", ["NSMutableString", "NSString", "NSObject"]);
    this.addClass("Song", ["Song", "OSItem", "NSObject"]);
    this.addClass("SongSetItem", ["SongSetItem", "NSObject"]);
    this.addClass("NSMutableArray", ["NSMutableArray", "NSArray", "NSObject"]);
    this.addClass("SongSetItemCollection", ["SongSetItemCollection", "OSCollection", "NSObject"]);
    this.addClass("SongSet", ["SongSet", "OSItem", "NSObject"]);
  }

  emptyDictionary() {
    return this.add({
      "NS.keys": [],
      "NS.objects": [],
      "$class": this.classRef("NSDictionary"),
    });
  }

  emptyArray() {
    return this.add({
      "NS.objects": [],
      "$class": this.classRef("NSArray"),
    });
  }

  mutableString(value: string) {
    return this.add({ "$class": this.classRef("NSMutableString"), "NS.string": value });
  }

  color(red: number, green: number, blue: number, alphaValue = 1) {
    const rgb = `${red} ${green} ${blue}`;
    return this.add({
      UIColorComponentCount: 4,
      UIGreen: green,
      UIBlue: blue,
      UIAlpha: alphaValue,
      NSRGB: new BplistData(rgb),
      "$class": this.classRef("UIColor"),
      UIRed: red,
      NSColorSpace: 2,
    });
  }

  notesDictionary() {
    const chords = this.emptyDictionary();
    const stickyNotes = this.emptyArray();
    const entries: [string, BplistUid][] = [
      ["showNotes", this.add(true)],
      ["performTransposition", this.add(true)],
      ["adjustForCapo", this.add(false)],
      ["showSectionLabels", this.add(true)],
      ["showTablature", this.add(false)],
      ["language", this.string("en")],
      ["beatsPerLine", this.number(6)],
      ["showTitle", this.add(true)],
      ["tablatureSize", this.real(0.16665999591350555)],
      ["showLyrics", this.add(true)],
      ["showChords", this.add(true)],
      ["repeatMode", this.number(1)],
      ["showCapoedChords", this.number(0)],
      ["chords", chords],
      ["restrictions", this.number(0)],
      ["chordStyle", this.number(0)],
      ["diagramPosition", this.number(0)],
      ["chordPosition", this.number(0)],
      ["instrument", this.string("guitar")],
      ["stickyNotes", stickyNotes],
      ["zoomPointX", this.number(0)],
      ["showMetadata", this.add(true)],
      ["zoomPointY", this.number(0)],
      ["zoomScale", this.number(1)],
      ["showExpanded", this.add(true)],
    ];

    return this.add({
      "NS.keys": entries.map(([key]) => this.string(key)),
      "NS.objects": entries.map(([, value]) => value),
      "$class": this.classRef("NSMutableDictionary"),
    });
  }

  resolveClasses(value: ArchiveValue): ArchiveValue {
    if (value && typeof value === "object" && (value as ClassRef).kind === "classRef") {
      const index = this.classIndexes.get((value as ClassRef).name);
      if (index == null) throw new Error(`Missing OnSong class dictionary for ${(value as ClassRef).name}.`);
      return this.uid(index);
    }
    if (Array.isArray(value)) return value.map((item) => this.resolveClasses(item));
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.resolveClasses(child)]));
    }
    return value;
  }

  finish(root: BplistUid) {
    this.addClassDictionaries();
    const resolvedObjects = this.objects.map((object) => this.resolveClasses(object));
    const archive = {
      "$version": 100000,
      "$archiver": "NSKeyedArchiver",
      "$top": { root },
      "$objects": resolvedObjects as never,
    };
    return writeBinaryPlist(archive as never);
  }
}

type SongDates = {
  lastImportedOn: BplistUid;
  syncTimestamp: BplistUid;
  created: BplistUid;
  modified: BplistUid;
  lastPlayedOn: BplistUid;
  viewed: BplistUid;
};

function addSongDates(builder: ArchiveBuilder, performanceDate: Date): SongDates {
  return {
    lastImportedOn: builder.date(performanceDate),
    syncTimestamp: builder.date(performanceDate),
    created: builder.date(performanceDate),
    modified: builder.date(performanceDate),
    lastPlayedOn: builder.date(performanceDate),
    viewed: builder.date(performanceDate),
  };
}

function songObject(builder: ArchiveBuilder, song: DbSong, songId: string, dates: SongDates) {
  const key = song.musicalKey?.trim() || null;
  const content = songContent(song);
  const titleAlpha = alpha(song.title);
  const titleSort = sortTitle(song.title);
  return {
    metadataFontSize: builder.real(14),
    ID: builder.string(songId),
    user: builder.string("Band Setlist"),
    key: builder.string(key),
    lastPlayedOn: dates.lastPlayedOn,
    headerFontColor: builder.color(0, 0, 0),
    favorite: NULL,
    flow: NULL,
    showMetadata: true,
    showLyrics: true,
    iconName: NULL,
    favoriteColor: NULL,
    showCapoedChords: 0,
    created: dates.created,
    bylineAlpha: builder.string(alpha(song.artist)),
    zoomScale: builder.number(1),
    fontName: builder.string("Helvetica"),
    notes: builder.notesDictionary(),
    title: builder.string(song.title),
    sortTitle: builder.string(titleSort),
    headerFontSize: builder.real(21),
    viewed: dates.viewed,
    chordStyle: 0,
    copyright: NULL,
    filepath: builder.string(`${song.artist} - ${song.title}.onsong`),
    fontColor: builder.color(0, 0, 0),
    ccli: NULL,
    capo: NULL,
    syncTimestamp: dates.syncTimestamp,
    metadataFontName: builder.string("Helvetica"),
    headerFontName: builder.string("Helvetica-Bold"),
    showTablature: false,
    monospacedFontSize: builder.real(14),
    zoomPointX: 0,
    diagramPosition: 0,
    highlightOpaque: true,
    providerName: NULL,
    monospacedFontColor: builder.color(0, 0, 0),
    monospacedFontName: builder.string("Courier"),
    beatsPerLine: builder.number(6),
    zoomPointY: 0,
    showNotes: true,
    tempo: NULL,
    showTitle: true,
    highlightColor: builder.color(1, 1, 1),
    deleted: builder.real(0),
    loaned: builder.real(0),
    usefile: builder.real(0),
    instructionsFontColor: builder.string("555555"),
    metadataFontColor: builder.color(0, 0, 0),
    lyrics: builder.mutableString(content),
    timeSignature: NULL,
    subdivision: NULL,
    providerUri: NULL,
    showExpanded: true,
    hash: builder.number(Math.abs([...song.id].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0))),
    showSectionLabels: true,
    byline: builder.string(song.artist),
    "$class": builder.classRef("Song"),
    duration: NULL,
    number: NULL,
    alphaStripped: builder.string(titleAlpha),
    chordFontColor: builder.color(0, 0, 0),
    chordPosition: 0,
    showChords: true,
    lineSpacing: builder.real(1),
    content: builder.string(content),
    pitch: NULL,
    chordFontSize: builder.real(14),
    mediaID: NULL,
    modified: dates.modified,
    alpha: builder.string(titleAlpha),
    imported: builder.real(1),
    lastImportedOn: dates.lastImportedOn,
    tablatureSize: 0.16665999591350555,
    performTransposition: false,
    keywords: NULL,
    chordFontName: builder.string("Helvetica"),
    transposedKey: builder.string(key),
    adjustForCapo: false,
    language: builder.string("en"),
    instrument: builder.string("guitar"),
    sortTitleStripped: builder.string(titleSort),
    fontSize: builder.real(14),
  };
}

export function createOnSongArchive(setlist: OnSongSetlist, sets: OnSongSet[]) {
  const builder = new ArchiveBuilder();
  const performanceDate = setlist.performedAt ?? setlist.createdAt ?? new Date();
  const flatSongs = sets.flatMap((set) => set.songs);
  const title = setlist.title || [setlist.bandName, setlist.venueName].filter(Boolean).join(" - ") || "Band Setlist";
  const setId = uuidFromSongId(setlist.id, 0);

  const setIndex = builder.reserve();
  const collectionIndex = builder.reserve();
  const collectionItemClassUid = builder.string("SongSetItem");
  const arrayIndex = builder.reserve();
  const itemUids: BplistUid[] = [];

  flatSongs.forEach((song, index) => {
    const itemIndex = builder.reserve();
    itemUids.push(builder.uid(itemIndex));
    const songId = uuidFromSongId(song.id, index + 1);
    const itemId = builder.string(JSON.stringify({ setID: setId, songID: songId, orderIndex: index }));
    const songIndex = builder.reserve();
    const dates = addSongDates(builder, performanceDate);

    builder.set(songIndex, songObject(builder, song, songId, dates));
    builder.set(itemIndex, {
      songID: builder.string(songId),
      bookID: NULL,
      "$class": builder.classRef("SongSetItem"),
      orderIndex: builder.number(index),
      setID: builder.string(setId),
      song: builder.uid(songIndex),
      ID: itemId,
    });
  });

  builder.set(arrayIndex, {
    "NS.objects": itemUids,
    "$class": builder.classRef("NSMutableArray"),
  });
  builder.set(collectionIndex, {
    collection: builder.uid(arrayIndex),
    "$class": builder.classRef("SongSetItemCollection"),
    class: collectionItemClassUid,
    index: NULL,
  });
  const datetime = builder.date(performanceDate);
  builder.set(setIndex, {
    modified: NULL,
    playbackContinuity: builder.number(0),
    useSeparateStyles: NULL,
    title: builder.string(title),
    unarchived: NULL,
    summary: NULL,
    "$class": builder.classRef("SongSet"),
    songs: builder.uid(collectionIndex),
    archived: NULL,
    providerName: NULL,
    sceneID: NULL,
    orderDirection: builder.number(0),
    datetime,
    quantity: NULL,
    orderMethod: builder.string("orderIndex"),
    user: NULL,
    providerUri: NULL,
    expires: NULL,
    ID: NULL,
    hasTime: NULL,
    created: NULL,
    orderIndex: NULL,
  });

  return builder.finish(builder.uid(setIndex));
}

export function onSongArchiveFilename(setlist: OnSongSetlist) {
  const band = setlist.bandName?.trim() || "Band Setlist";
  const venue = setlist.venueName?.trim() || "Setlist";
  const date = (setlist.performedAt ?? setlist.createdAt ?? new Date()).toISOString().slice(0, 10);
  return `${band} - ${venue} - ${date} - OnSong.archive`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
}
