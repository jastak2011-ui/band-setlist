import fs from "node:fs";

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
  for (let index = 0; index < objectCount; index++) {
    offsets.push(Number(readUIntBE(buffer, offsetTableStart + index * offsetSize, offsetSize)));
  }

  const cache = new Map();
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
    if (type === 0) value = info === 0 ? null : info === 8 ? false : info === 9 ? true : { simple: info };
    else if (type === 1) value = Number(readUIntBE(buffer, offset + 1, 1 << info));
    else if (type === 2) value = info === 3 ? buffer.readDoubleBE(offset + 1) : buffer.readFloatBE(offset + 1);
    else if (type === 3) value = { date: new Date((buffer.readDoubleBE(offset + 1) + 978307200) * 1000).toISOString() };
    else if (type === 4) {
      const data = readLength(offset + 1, info);
      value = { dataLength: data.length };
    } else if (type === 5) {
      const data = readLength(offset + 1, info);
      value = buffer.subarray(data.offset, data.offset + data.length).toString("ascii");
    } else if (type === 6) {
      const data = readLength(offset + 1, info);
      value = buffer.subarray(data.offset, data.offset + data.length * 2).swap16().toString("utf16le");
    } else if (type === 8) value = { UID: Number(readUIntBE(buffer, offset + 1, info + 1)) };
    else if (type === 10) {
      const array = [];
      const data = readLength(offset + 1, info);
      cache.set(index, array);
      for (let item = 0; item < data.length; item++) {
        array.push(parseObject(Number(readUIntBE(buffer, data.offset + item * refSize, refSize))));
      }
      value = array;
    } else if (type === 13) {
      const dict = {};
      const data = readLength(offset + 1, info);
      cache.set(index, dict);
      for (let item = 0; item < data.length; item++) {
        const key = parseObject(Number(readUIntBE(buffer, data.offset + item * refSize, refSize)));
        const child = parseObject(Number(readUIntBE(buffer, data.offset + data.length * refSize + item * refSize, refSize)));
        dict[key] = child;
      }
      value = dict;
    } else throw new Error(`Unsupported plist marker ${marker.toString(16)} at object ${index}.`);
    cache.set(index, value);
    return value;
  }

  return { root: parseObject(topObject), objectCount };
}

function uid(objects, value) {
  return value && typeof value === "object" && Number.isInteger(value.UID) ? objects[value.UID] : value;
}

function validateArchive(path) {
  const parsed = parseBinaryPlist(fs.readFileSync(path));
  const archive = parsed.root;
  const objects = archive.$objects;
  const classNames = new Map();
  objects.forEach((object, index) => {
    if (object && typeof object === "object" && object.$classname) classNames.set(index, object.$classname);
  });
  const classFor = (object) => object && typeof object === "object" && object.$class ? classNames.get(object.$class.UID) : null;
  const root = uid(objects, archive.$top?.root);
  const collection = uid(objects, root?.songs);
  const itemArray = uid(objects, collection?.collection);
  const items = Array.isArray(itemArray?.["NS.objects"]) ? itemArray["NS.objects"].map((item) => uid(objects, item)) : [];
  const errors = [];

  if (archive.$archiver !== "NSKeyedArchiver") errors.push("Missing NSKeyedArchiver marker.");
  if (classFor(root) !== "SongSet") errors.push("Root object is not SongSet.");
  if (classFor(collection) !== "SongSetItemCollection") errors.push("songs is not SongSetItemCollection.");
  if (!Array.isArray(itemArray?.["NS.objects"])) errors.push("collection does not contain NS.objects.");

  items.forEach((item, index) => {
    const song = uid(objects, item.song);
    const itemSongId = uid(objects, item.songID);
    const songId = uid(objects, song?.ID);
    if (classFor(item) !== "SongSetItem") errors.push(`Item ${index} is not SongSetItem.`);
    if (classFor(song) !== "Song") errors.push(`Item ${index} embedded song is not Song.`);
    if (itemSongId !== songId) errors.push(`Item ${index} songID does not match embedded Song ID.`);
    if (uid(objects, item.orderIndex) !== index) errors.push(`Item ${index} orderIndex mismatch.`);
  });

  for (const [index, object] of objects.entries()) {
    if (object && typeof object === "object" && object.$class && !classNames.has(object.$class.UID)) {
      errors.push(`Object ${index} has invalid $class UID ${object.$class.UID}.`);
    }
  }

  console.log(`Archive: ${path}`);
  console.log(`Binary plist objects: ${parsed.objectCount}`);
  console.log(`NSKeyedArchiver objects: ${objects.length}`);
  console.log(`Root class: ${classFor(root)}`);
  console.log(`Song count: ${items.length}`);
  console.log(`Classes: ${[...classNames.values()].join(", ")}`);
  console.log(errors.length ? `Errors:\n- ${errors.join("\n- ")}` : "Validation checks passed.");
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node scripts/validate-onsong-archive.mjs <archive> [archive...]");
  process.exit(1);
}
paths.forEach(validateArchive);
