export class BplistUid {
  kind = "uid" as const;
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

export class BplistData {
  kind = "data" as const;
  value: Buffer;

  constructor(value: Buffer | string) {
    this.value = typeof value === "string" ? Buffer.from(value, "ascii") : value;
  }
}

export class BplistReal {
  kind = "real" as const;
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

export type BplistObject = null | boolean | number | string | Date | BplistUid | BplistData | BplistReal | BplistObject[] | { [key: string]: BplistObject };

function isUid(value: unknown): value is BplistUid {
  return value instanceof BplistUid || Boolean(value && typeof value === "object" && (value as BplistUid).kind === "uid" && Number.isInteger((value as BplistUid).value));
}

function isData(value: unknown): value is BplistData {
  return value instanceof BplistData || Boolean(value && typeof value === "object" && (value as BplistData).kind === "data" && Buffer.isBuffer((value as BplistData).value));
}

function isReal(value: unknown): value is BplistReal {
  return value instanceof BplistReal || Boolean(value && typeof value === "object" && (value as BplistReal).kind === "real" && typeof (value as BplistReal).value === "number");
}

function intSize(value: number) {
  if (value <= 0xff) return 1;
  if (value <= 0xffff) return 2;
  if (value <= 0xffffffff) return 4;
  return 8;
}

function writeUInt(value: number, size: number) {
  const buffer = Buffer.alloc(size);
  let remaining = BigInt(value);
  for (let index = size - 1; index >= 0; index--) {
    buffer[index] = Number(remaining & BigInt(0xff));
    remaining >>= BigInt(8);
  }
  return buffer;
}

function writeNumber(value: number) {
  if (Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
    const size = intSize(value);
    return Buffer.concat([Buffer.from([0x10 | Math.log2(size)]), writeUInt(value, size)]);
  }
  const buffer = Buffer.alloc(9);
  buffer[0] = 0x23;
  buffer.writeDoubleBE(value, 1);
  return buffer;
}

function writeReal(value: number) {
  const buffer = Buffer.alloc(9);
  buffer[0] = 0x23;
  buffer.writeDoubleBE(value, 1);
  return buffer;
}

function lengthHeader(type: number, length: number) {
  if (length < 15) return Buffer.from([(type << 4) | length]);
  return Buffer.concat([Buffer.from([(type << 4) | 0x0f]), writeNumber(length)]);
}

function writeString(value: string) {
  if (/^[\x00-\x7f]*$/.test(value)) {
    const data = Buffer.from(value, "ascii");
    return Buffer.concat([lengthHeader(0x5, data.length), data]);
  }
  const data = Buffer.from(value, "utf16le").swap16();
  return Buffer.concat([lengthHeader(0x6, data.length / 2), data]);
}

function writeDate(value: Date) {
  const buffer = Buffer.alloc(9);
  buffer[0] = 0x33;
  buffer.writeDoubleBE(value.getTime() / 1000 - 978307200, 1);
  return buffer;
}

function writeData(value: Buffer) {
  return Buffer.concat([lengthHeader(0x4, value.length), value]);
}

function writeUid(value: number) {
  const size = intSize(value);
  return Buffer.concat([Buffer.from([0x80 | (size - 1)]), writeUInt(value, size)]);
}

function readUIntBE(buffer: Buffer, offset: number, length: number) {
  let value = BigInt(0);
  for (let index = 0; index < length; index++) value = (value << BigInt(8)) + BigInt(buffer[offset + index]);
  return value;
}

export function parseBinaryPlist(buffer: Buffer): BplistObject {
  if (buffer.subarray(0, 8).toString("ascii") !== "bplist00") throw new Error("Not a binary plist.");

  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const objectCount = Number(readUIntBE(trailer, 8, 8));
  const topObject = Number(readUIntBE(trailer, 16, 8));
  const offsetTableStart = Number(readUIntBE(trailer, 24, 8));
  const offsets: number[] = [];

  for (let index = 0; index < objectCount; index++) {
    offsets.push(Number(readUIntBE(buffer, offsetTableStart + index * offsetSize, offsetSize)));
  }

  const cache = new Map<number, BplistObject>();

  function readLength(offset: number, markerLength: number) {
    if (markerLength < 15) return { length: markerLength, offset };
    const marker = buffer[offset];
    const size = 1 << (marker & 0x0f);
    return { length: Number(readUIntBE(buffer, offset + 1, size)), offset: offset + 1 + size };
  }

  function parseObject(index: number): BplistObject {
    const cached = cache.get(index);
    if (cached !== undefined) return cached;

    const offset = offsets[index];
    const marker = buffer[offset];
    const type = marker >> 4;
    const info = marker & 0x0f;
    let value: BplistObject;

    if (type === 0) {
      value = info === 0 ? null : info === 8 ? false : info === 9 ? true : null;
    } else if (type === 1) {
      value = Number(readUIntBE(buffer, offset + 1, 1 << info));
    } else if (type === 2) {
      value = new BplistReal(info === 3 ? buffer.readDoubleBE(offset + 1) : buffer.readFloatBE(offset + 1));
    } else if (type === 3) {
      value = new Date((buffer.readDoubleBE(offset + 1) + 978307200) * 1000);
    } else if (type === 4) {
      const data = readLength(offset + 1, info);
      value = new BplistData(buffer.subarray(data.offset, data.offset + data.length));
    } else if (type === 5) {
      const data = readLength(offset + 1, info);
      value = buffer.subarray(data.offset, data.offset + data.length).toString("ascii");
    } else if (type === 6) {
      const data = readLength(offset + 1, info);
      value = buffer.subarray(data.offset, data.offset + data.length * 2).swap16().toString("utf16le");
    } else if (type === 8) {
      value = new BplistUid(Number(readUIntBE(buffer, offset + 1, info + 1)));
    } else if (type === 10) {
      const data = readLength(offset + 1, info);
      const array: BplistObject[] = [];
      cache.set(index, array);
      for (let item = 0; item < data.length; item++) {
        array.push(parseObject(Number(readUIntBE(buffer, data.offset + item * refSize, refSize))));
      }
      value = array;
    } else if (type === 13) {
      const data = readLength(offset + 1, info);
      const dictionary: { [key: string]: BplistObject } = {};
      cache.set(index, dictionary);
      for (let item = 0; item < data.length; item++) {
        const key = parseObject(Number(readUIntBE(buffer, data.offset + item * refSize, refSize)));
        const child = parseObject(Number(readUIntBE(buffer, data.offset + data.length * refSize + item * refSize, refSize)));
        dictionary[String(key)] = child;
      }
      value = dictionary;
    } else {
      throw new Error(`Unsupported binary plist marker ${marker.toString(16)} at object ${index}.`);
    }

    cache.set(index, value);
    return value;
  }

  return parseObject(topObject);
}

export function writeBinaryPlist(root: BplistObject) {
  const objects: BplistObject[] = [];
  const arrayRefs = new WeakMap<BplistObject[], number[]>();
  const dictRefs = new WeakMap<object, { keys: number[]; values: number[] }>();

  function add(value: BplistObject): number {
    const index = objects.length;
    objects.push(value);
    if (Array.isArray(value)) {
      arrayRefs.set(value, value.map(add));
    } else if (
      value &&
      !(value instanceof Date) &&
      !isUid(value) &&
      !isData(value) &&
      !isReal(value) &&
      typeof value === "object"
    ) {
      dictRefs.set(value, {
        keys: Object.keys(value).map((key) => add(key)),
        values: Object.values(value).map(add),
      });
    }
    return index;
  }

  add(root);

  const refSize = intSize(objects.length - 1);

  function ref(index: number) {
    return writeUInt(index, refSize);
  }

  let cursor = 8;
  const encoded = objects.map((object) => {
    let buffer: Buffer;
    if (object === null) buffer = Buffer.from([0x00]);
    else if (object === false) buffer = Buffer.from([0x08]);
    else if (object === true) buffer = Buffer.from([0x09]);
    else if (typeof object === "number") buffer = writeNumber(object);
    else if (typeof object === "string") buffer = writeString(object);
    else if (object instanceof Date) buffer = writeDate(object);
    else if (isUid(object)) buffer = writeUid(object.value);
    else if (isData(object)) buffer = writeData(object.value);
    else if (isReal(object)) buffer = writeReal(object.value);
    else if (Array.isArray(object)) {
      buffer = Buffer.concat([lengthHeader(0xa, object.length), ...(arrayRefs.get(object) ?? []).map(ref)]);
    } else {
      const entries = Object.entries(object);
      const childRefs = dictRefs.get(object) ?? { keys: [], values: [] };
      const keyRefs = childRefs.keys.map(ref);
      const valueRefs = childRefs.values.map(ref);
      buffer = Buffer.concat([lengthHeader(0xd, entries.length), ...keyRefs, ...valueRefs]);
    }
    cursor += buffer.length;
    return buffer;
  });

  const offsets: number[] = [];
  cursor = 8;
  for (const object of encoded) {
    offsets.push(cursor);
    cursor += object.length;
  }

  const offsetSize = intSize(cursor);
  const offsetTable = Buffer.concat(offsets.map((offset) => writeUInt(offset, offsetSize)));
  const trailer = Buffer.alloc(32);
  trailer[6] = offsetSize;
  trailer[7] = refSize;
  writeUInt(objects.length, 8).copy(trailer, 8);
  writeUInt(0, 8).copy(trailer, 16);
  writeUInt(cursor, 8).copy(trailer, 24);

  return Buffer.concat([Buffer.from("bplist00", "ascii"), ...encoded, offsetTable, trailer]);
}
