import fs from "node:fs";
import path from "node:path";

function readUIntBE(buffer, offset, length) {
  let value = 0n;
  for (let index = 0; index < length; index++) value = (value << 8n) + BigInt(buffer[offset + index]);
  return value;
}

function parseBinaryPlist(buffer) {
  if (buffer.subarray(0, 8).toString("ascii") !== "bplist00") throw new Error("Not a binary plist.");
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const objectCount = Number(readUIntBE(trailer, 8, 8));
  const topObject = Number(readUIntBE(trailer, 16, 8));
  const offsetTableStart = Number(readUIntBE(trailer, 24, 8));
  const offsets = [];
  for (let index = 0; index < objectCount; index++) offsets.push(Number(readUIntBE(buffer, offsetTableStart + index * offsetSize, offsetSize)));

  const cache = new Map();
  const objectTypes = new Map();
  const arrayRefs = new WeakMap();

  function readLength(offset, markerLength) {
    if (markerLength < 15) return { length: markerLength, offset };
    const marker = buffer[offset];
    const size = 1 << (marker & 0x0f);
    return { length: Number(readUIntBE(buffer, offset + 1, size)), offset: offset + 1 + size };
  }

  function parseObject(index) {
    if (cache.has(index)) return cache.get(index);
    const offset = offsets[index];
    const marker = buffer[offset];
    const type = marker >> 4;
    const info = marker & 0x0f;
    let value;

    if (type === 0) {
      objectTypes.set(index, info === 8 || info === 9 ? "boolean" : "null");
      value = info === 0 ? null : info === 8 ? false : info === 9 ? true : { simple: info };
    } else if (type === 1) {
      objectTypes.set(index, "integer");
      value = Number(readUIntBE(buffer, offset + 1, 1 << info));
    } else if (type === 2) {
      objectTypes.set(index, "real");
      value = info === 3 ? buffer.readDoubleBE(offset + 1) : buffer.readFloatBE(offset + 1);
    } else if (type === 3) {
      objectTypes.set(index, "date");
      value = { date: new Date((buffer.readDoubleBE(offset + 1) + 978307200) * 1000).toISOString() };
    } else if (type === 4) {
      objectTypes.set(index, "data");
      const data = readLength(offset + 1, info);
      value = { dataLength: data.length };
    } else if (type === 5) {
      objectTypes.set(index, "string");
      const data = readLength(offset + 1, info);
      value = buffer.subarray(data.offset, data.offset + data.length).toString("ascii");
    } else if (type === 6) {
      objectTypes.set(index, "string");
      const data = readLength(offset + 1, info);
      value = buffer.subarray(data.offset, data.offset + data.length * 2).swap16().toString("utf16le");
    } else if (type === 8) {
      objectTypes.set(index, "uid");
      value = { UID: Number(readUIntBE(buffer, offset + 1, info + 1)) };
    } else if (type === 10) {
      objectTypes.set(index, "array");
      const array = [];
      const refs = [];
      const data = readLength(offset + 1, info);
      cache.set(index, array);
      for (let item = 0; item < data.length; item++) {
        const ref = Number(readUIntBE(buffer, data.offset + item * refSize, refSize));
        refs.push(ref);
        array.push(parseObject(ref));
      }
      arrayRefs.set(array, refs);
      value = array;
    } else if (type === 13) {
      objectTypes.set(index, "dictionary");
      const dict = {};
      const data = readLength(offset + 1, info);
      cache.set(index, dict);
      for (let item = 0; item < data.length; item++) {
        const key = parseObject(Number(readUIntBE(buffer, data.offset + item * refSize, refSize)));
        const child = parseObject(Number(readUIntBE(buffer, data.offset + data.length * refSize + item * refSize, refSize)));
        dict[key] = child;
      }
      value = dict;
    } else {
      throw new Error(`Unsupported plist marker ${marker.toString(16)} at object ${index}.`);
    }
    cache.set(index, value);
    return value;
  }

  return { root: parseObject(topObject), objectCount, objectTypes, arrayRefs };
}

function uid(objects, value) {
  return value && typeof value === "object" && Number.isInteger(value.UID) ? objects[value.UID] : value;
}

function uidIndex(value) {
  return value && typeof value === "object" && Number.isInteger(value.UID) ? value.UID : null;
}

function metadata(parsed) {
  const objects = parsed.root.$objects;
  const archiveObjectRefs = parsed.arrayRefs.get(objects) ?? [];
  const classNames = new Map();
  objects.forEach((object, index) => {
    if (object && typeof object === "object" && object.$classname) classNames.set(index, object.$classname);
  });
  const classFor = (object) => (object && typeof object === "object" && object.$class ? classNames.get(object.$class.UID) : null);
  const archivedObjectType = (archiveIndex) => parsed.objectTypes.get(archiveObjectRefs[archiveIndex]);
  return { objects, classNames, classFor, archivedObjectType };
}

function setItems(meta, parsed) {
  const root = uid(meta.objects, parsed.root.$top?.root);
  const collection = uid(meta.objects, root?.songs);
  const itemArray = uid(meta.objects, collection?.collection);
  const itemRefs = Array.isArray(itemArray?.["NS.objects"]) ? itemArray["NS.objects"] : [];
  return { root, collection, itemArray, itemRefs, items: itemRefs.map((item) => uid(meta.objects, item)) };
}

function valueShape(meta, value) {
  const index = uidIndex(value);
  if (index == null) return `${typeof value}:${JSON.stringify(value)}`;
  if (index === 0) return "uid:null";
  const object = meta.objects[index];
  const className = meta.classFor(object);
  return `uid:${meta.archivedObjectType(index)}${className ? `:${className}` : ""}`;
}

function noteKeys(meta, song) {
  const notes = uid(meta.objects, song?.notes);
  if (!notes || typeof notes !== "object" || !Array.isArray(notes["NS.keys"])) return [];
  return notes["NS.keys"].map((key) => uid(meta.objects, key));
}

function noteMap(meta, song) {
  const notes = uid(meta.objects, song?.notes);
  const keys = noteKeys(meta, song);
  const values = Array.isArray(notes?.["NS.objects"]) ? notes["NS.objects"] : [];
  return new Map(keys.map((key, index) => [key, values[index]]));
}

function compareKeyList(label, actual, expected, errors) {
  const actualText = actual.join("|");
  const expectedText = expected.join("|");
  if (actualText !== expectedText) errors.push(`${label} keys/order differ from template.`);
}

function validateArchive(archivePath) {
  const parsed = parseBinaryPlist(fs.readFileSync(archivePath));
  const meta = metadata(parsed);
  const { root, collection, itemArray, itemRefs, items } = setItems(meta, parsed);
  const errors = [];

  if (parsed.root.$archiver !== "NSKeyedArchiver") errors.push("Missing NSKeyedArchiver marker.");
  if (meta.classFor(root) !== "SongSet") errors.push("Root object is not SongSet.");
  if (meta.classFor(collection) !== "SongSetItemCollection") errors.push("songs is not SongSetItemCollection.");
  if (meta.classFor(itemArray) !== "NSMutableArray") errors.push("collection is not NSMutableArray.");
  if (parsed.root.$top?.root?.UID !== 1) errors.push("SongSet root is not object 1.");
  if (meta.classFor(meta.objects[1]) !== "SongSet") errors.push("Object 1 is not SongSet.");
  if (meta.classFor(meta.objects[2]) !== "SongSetItemCollection") errors.push("Object 2 is not SongSetItemCollection.");
  if (meta.objects[3] !== "SongSetItem") errors.push('Object 3 is not the "SongSetItem" collection class string.');
  if (meta.classFor(meta.objects[4]) !== "NSMutableArray") errors.push("Object 4 is not the SongSetItem NSMutableArray.");

  items.forEach((item, index) => {
    const itemIndex = itemRefs[index]?.UID;
    const song = uid(meta.objects, item?.song);
    const songIndex = item?.song?.UID;
    if (meta.classFor(item) !== "SongSetItem") errors.push(`Item ${index} is not SongSetItem.`);
    if (meta.classFor(song) !== "Song") errors.push(`Item ${index} embedded song is not Song.`);
    if (!Number.isInteger(itemIndex) || !Number.isInteger(songIndex) || songIndex <= itemIndex || songIndex - itemIndex > 3) {
      errors.push(`Item ${index} is not followed closely by its embedded Song.`);
    }
    if (uid(meta.objects, item.songID) !== uid(meta.objects, song?.ID)) errors.push(`Item ${index} songID does not match embedded Song ID.`);
    if (uid(meta.objects, item.orderIndex) !== index) errors.push(`Item ${index} orderIndex mismatch.`);
  });

  const templatePath = path.join(process.cwd(), "public", "onsong-template.archive");
  if (fs.existsSync(templatePath) && path.resolve(archivePath) !== path.resolve(templatePath)) {
    const templateParsed = parseBinaryPlist(fs.readFileSync(templatePath));
    const templateMeta = metadata(templateParsed);
    const templateSet = setItems(templateMeta, templateParsed);

    const generatedClasses = [...meta.classNames.values()].join("|");
    const templateClasses = [...templateMeta.classNames.values()].join("|");
    if (generatedClasses !== templateClasses) errors.push("Class hierarchy/order differs from template.");

    items.forEach((item, index) => {
      const templateItem = templateSet.items[index] ?? templateSet.items[1] ?? templateSet.items[0];
      const song = uid(meta.objects, item.song);
      const templateSong = uid(templateMeta.objects, templateItem.song);
      const templateLabel = index < templateSet.items.length ? index : 1;

      compareKeyList(`Item ${index}`, Object.keys(item), Object.keys(templateItem), errors);
      compareKeyList(`Song ${index}`, Object.keys(song), Object.keys(templateSong), errors);
      compareKeyList(`Song ${index} notes`, noteKeys(meta, song), noteKeys(templateMeta, templateSong), errors);

      const replacedItemFields = new Set(["songID", "setID", "ID", "orderIndex"]);
      const replacedSongFields = new Set([
        "ID",
        "title",
        "sortTitle",
        "sortTitleStripped",
        "alpha",
        "alphaStripped",
        "byline",
        "bylineAlpha",
        "content",
        "lyrics",
        "filepath",
        "key",
        "transposedKey",
        "hash",
        "user",
        "providerName",
        "providerUri",
        "tempo",
        "duration",
      ]);

      for (const key of Object.keys(templateItem)) {
        if (replacedItemFields.has(key)) continue;
        if (valueShape(meta, item[key]) !== valueShape(templateMeta, templateItem[key])) {
          errors.push(`Item ${index}.${key} type differs from template item ${templateLabel}.`);
        }
      }

      for (const key of Object.keys(templateSong)) {
        if (replacedSongFields.has(key)) continue;
        if (valueShape(meta, song[key]) !== valueShape(templateMeta, templateSong[key])) {
          errors.push(`Song ${index}.${key} type differs from template song ${templateLabel}.`);
        }
      }

      const generatedNotes = noteMap(meta, song);
      const templateNotes = noteMap(templateMeta, templateSong);
      for (const [key, templateValue] of templateNotes) {
        if (valueShape(meta, generatedNotes.get(key)) !== valueShape(templateMeta, templateValue)) {
          errors.push(`Song ${index}.notes.${key} type differs from template song ${templateLabel}.`);
        }
      }
    });
  }

  console.log(`Archive: ${archivePath}`);
  console.log(`Binary plist objects: ${parsed.objectCount}`);
  console.log(`NSKeyedArchiver objects: ${meta.objects.length}`);
  console.log(`Root class: ${meta.classFor(root)}`);
  console.log(`Song count: ${items.length}`);
  console.log(`Classes: ${[...meta.classNames.values()].join(", ")}`);
  console.log(errors.length ? `Errors:\n- ${errors.join("\n- ")}` : "Validation checks passed.");
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node scripts/validate-onsong-archive.mjs <archive> [archive...]");
  process.exit(1);
}
paths.forEach(validateArchive);
