import { BplistData, BplistUid, writeBinaryPlist } from "@/lib/bplist";
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

class ArchiveBuilder {
  objects: unknown[] = ["$null"];
  classIndexes = {
    mutableString: 0,
    dictionary: 0,
    array: 0,
    mutableDictionary: 0,
    color: 0,
    date: 0,
    song: 0,
    item: 0,
    mutableArray: 0,
    collection: 0,
    set: 0,
  };

  constructor() {
    this.classIndexes.mutableString = this.addClass("NSMutableString", ["NSMutableString", "NSString", "NSObject"]);
    this.classIndexes.dictionary = this.addClass("NSDictionary", ["NSDictionary", "NSObject"]);
    this.classIndexes.array = this.addClass("NSArray", ["NSArray", "NSObject"]);
    this.classIndexes.mutableDictionary = this.addClass("NSMutableDictionary", ["NSMutableDictionary", "NSDictionary", "NSObject"]);
    this.classIndexes.color = this.addClass("UIColor", ["UIColor", "NSObject"]);
    this.classIndexes.date = this.addClass("NSDate", ["NSDate", "NSObject"]);
    this.classIndexes.song = this.addClass("Song", ["Song", "NSObject"]);
    this.classIndexes.item = this.addClass("SongSetItem", ["SongSetItem", "NSObject"]);
    this.classIndexes.mutableArray = this.addClass("NSMutableArray", ["NSMutableArray", "NSArray", "NSObject"]);
    this.classIndexes.collection = this.addClass("SongSetItemCollection", ["SongSetItemCollection", "OSCollection", "NSObject"]);
    this.classIndexes.set = this.addClass("SongSet", ["SongSet", "NSObject"]);
  }

  add(value: unknown) {
    this.objects.push(value);
    return new BplistUid(this.objects.length - 1);
  }

  addClass(classname: string, classes: string[]) {
    this.objects.push({ "$classes": classes, "$classname": classname });
    return this.objects.length - 1;
  }

  string(value: string | null | undefined) {
    return value == null ? NULL : this.add(value);
  }

  number(value: number | null | undefined) {
    return value == null || Number.isNaN(value) ? NULL : this.add(value);
  }

  date(value: Date) {
    return this.add({ "NS.time": secondsSinceAppleEpoch(value), "$class": new BplistUid(this.classIndexes.date) });
  }

  mutableString(value: string) {
    return this.add({ "$class": new BplistUid(this.classIndexes.mutableString), "NS.string": value });
  }

  emptyDictionary() {
    return this.add({
      "NS.keys": [],
      "NS.objects": [],
      "$class": new BplistUid(this.classIndexes.dictionary),
    });
  }

  emptyMutableDictionary() {
    return this.add({
      "NS.keys": [],
      "NS.objects": [],
      "$class": new BplistUid(this.classIndexes.mutableDictionary),
    });
  }

  color(red: number, green: number, blue: number, alphaValue = 1) {
    const rgb = `${red} ${green} ${blue}`;
    return this.add({
      UIColorComponentCount: 4,
      UIGreen: green,
      UIBlue: blue,
      UIAlpha: alphaValue,
      NSRGB: new BplistData(rgb),
      "$class": new BplistUid(this.classIndexes.color),
      UIRed: red,
      NSColorSpace: 2,
    });
  }

  mutableArray(items: BplistUid[]) {
    return this.add({ "NS.objects": items, "$class": new BplistUid(this.classIndexes.mutableArray) });
  }

  song(song: DbSong, songId: string, dateUid: BplistUid, colors: OnSongColors) {
    const key = song.musicalKey?.trim() || null;
    const content = songContent(song);
    const titleAlpha = alpha(song.title);
    const titleSort = sortTitle(song.title);
    return this.add({
      metadataFontSize: this.number(14),
      ID: this.string(songId),
      user: this.string("Band Setlist"),
      key: this.string(key),
      lastPlayedOn: dateUid,
      headerFontColor: colors.black,
      favorite: NULL,
      flow: NULL,
      showMetadata: true,
      showLyrics: true,
      iconName: NULL,
      favoriteColor: NULL,
      showCapoedChords: 0,
      created: dateUid,
      bylineAlpha: this.string(alpha(song.artist)),
      zoomScale: this.number(1),
      fontName: this.string("Helvetica"),
      notes: this.emptyMutableDictionary(),
      title: this.string(song.title),
      sortTitle: this.mutableString(titleSort),
      headerFontSize: this.number(21),
      viewed: dateUid,
      chordStyle: 0,
      copyright: NULL,
      filepath: this.string(`${song.artist} - ${song.title}.onsong`),
      fontColor: colors.black,
      ccli: NULL,
      capo: NULL,
      syncTimestamp: dateUid,
      metadataFontName: this.string("Helvetica"),
      headerFontName: this.string("Helvetica-Bold"),
      showTablature: false,
      monospacedFontSize: this.number(14),
      zoomPointX: 0,
      diagramPosition: 0,
      highlightOpaque: true,
      providerName: NULL,
      monospacedFontColor: colors.black,
      monospacedFontName: this.string("Courier"),
      beatsPerLine: this.number(6),
      zoomPointY: 0,
      showNotes: true,
      tempo: this.number(song.bpm ?? null),
      showTitle: true,
      highlightColor: colors.highlight,
      deleted: this.number(0),
      loaned: this.number(0),
      usefile: this.number(0),
      instructionsFontColor: this.string("555555"),
      metadataFontColor: colors.black,
      lyrics: this.mutableString(content),
      timeSignature: NULL,
      subdivision: NULL,
      providerUri: NULL,
      showExpanded: true,
      hash: this.number(Math.abs([...song.id].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0))),
      showSectionLabels: true,
      byline: this.string(song.artist),
      "$class": new BplistUid(this.classIndexes.song),
      duration: this.number(song.durationSec ?? null),
      number: NULL,
      alphaStripped: this.string(titleAlpha),
      chordFontColor: colors.black,
      chordPosition: 0,
      showChords: true,
      lineSpacing: this.number(1),
      content: this.string(content),
      pitch: NULL,
      chordFontSize: this.number(14),
      mediaID: NULL,
      modified: dateUid,
      alpha: this.string(titleAlpha),
      imported: this.number(1),
      lastImportedOn: dateUid,
      tablatureSize: 0.16665999591350555,
      performTransposition: false,
      keywords: NULL,
      chordFontName: this.string("Helvetica"),
      transposedKey: this.string(key),
      adjustForCapo: false,
      language: this.string("en"),
      instrument: this.string("guitar"),
      sortTitleStripped: this.string(titleSort),
      fontSize: this.number(14),
    });
  }
}

type OnSongColors = {
  black: BplistUid;
  highlight: BplistUid;
};

export function createOnSongArchive(setlist: OnSongSetlist, sets: OnSongSet[]) {
  const builder = new ArchiveBuilder();
  const now = new Date();
  const performanceDate = setlist.performedAt ?? setlist.createdAt ?? now;
  const flatSongs = sets.flatMap((set) => set.songs);
  const dateUid = builder.date(performanceDate);
  const setId = uuidFromSongId(setlist.id, 0);
  const colors: OnSongColors = {
    black: builder.color(0, 0, 0),
    highlight: builder.color(1, 1, 1),
  };

  const itemUids = flatSongs.map((song, index) => {
    const songId = uuidFromSongId(song.id, index + 1);
    const songUid = builder.song(song, songId, dateUid, colors);
    return builder.add({
      songID: builder.string(songId),
      bookID: NULL,
      "$class": new BplistUid(builder.classIndexes.item),
      orderIndex: builder.number(index),
      setID: builder.string(setId),
      song: songUid,
      ID: builder.string(JSON.stringify({ setID: setId, songID: songId, orderIndex: index })),
    });
  });

  const mutableArrayUid = builder.mutableArray(itemUids);
  const collectionUid = builder.add({
    collection: mutableArrayUid,
    "$class": new BplistUid(builder.classIndexes.collection),
    class: builder.string("SongSetItem"),
    index: NULL,
  });
  const title = setlist.title || [setlist.bandName, setlist.venueName].filter(Boolean).join(" - ") || "Band Setlist";
  const setUid = builder.add({
    modified: NULL,
    playbackContinuity: builder.number(0),
    useSeparateStyles: NULL,
    title: builder.string(title),
    unarchived: NULL,
    summary: NULL,
    "$class": new BplistUid(builder.classIndexes.set),
    songs: collectionUid,
    archived: NULL,
    providerName: NULL,
    sceneID: NULL,
    orderDirection: builder.number(0),
    datetime: dateUid,
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

  const archive = {
    "$version": 100000,
    "$archiver": "NSKeyedArchiver",
    "$top": { root: setUid },
    "$objects": builder.objects as never,
  };

  return writeBinaryPlist(archive as never);
}

export function onSongArchiveFilename(setlist: OnSongSetlist) {
  const band = setlist.bandName?.trim() || "Band Setlist";
  const venue = setlist.venueName?.trim() || "Setlist";
  const date = (setlist.performedAt ?? setlist.createdAt ?? new Date()).toISOString().slice(0, 10);
  return `${band} - ${venue} - ${date} - OnSong.archive`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
}
