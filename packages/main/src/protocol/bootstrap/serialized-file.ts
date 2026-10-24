import { ByteReader, type Endian } from './byte-reader.js';
import { lookupCommonString } from './unity-common-strings.js';

/**
 * Reader for the Unity `SerializedFile` (the `CAB-...` entry inside a bundle).
 *
 * Only the head of the file is parsed — header, type table (with the embedded
 * type trees) and the object table — because that is everything needed to read
 * `BundleInfoSO` and `TextAsset` payloads. Scripts/externals/ref-types that
 * follow the object table are never touched.
 *
 * Reference behaviour: the first four header fields are big-endian, then the
 * header's endianness flag selects the byte order for everything after it.
 */
const HEADER_ALIGNMENT = 4;
const HASH128_SIZE = 16;

/** Class ids of the Unity types this reader understands. */
export const ClassId = {
  TextAsset: 49,
  MonoBehaviour: 114,
  MonoScript: 115,
} as const;

export interface TypeTreeNode {
  version: number;
  level: number;
  typeFlags: number;
  type: string;
  name: string;
  byteSize: number;
  index: number;
  metaFlag: number;
  children: TypeTreeNode[];
}

export interface SerializedType {
  classId: number;
  isStripped: boolean;
  scriptTypeIndex: number;
  node: TypeTreeNode | null;
}

export interface SerializedObject {
  pathId: number;
  byteStart: number;
  byteSize: number;
  typeId: number;
  type: SerializedType;
}

export type TypetreeValue =
  number | boolean | string | Uint8Array | TypetreeValue[] | { [key: string]: TypetreeValue };

const PRIMITIVES: Record<string, (reader: ByteReader) => number | boolean> = {
  SInt8: (reader) => reader.i8(),
  UInt8: (reader) => reader.u8(),
  char: (reader) => reader.u8(),
  short: (reader) => reader.i16(),
  SInt16: (reader) => reader.i16(),
  'unsigned short': (reader) => reader.u16(),
  UInt16: (reader) => reader.u16(),
  int: (reader) => reader.i32(),
  SInt32: (reader) => reader.i32(),
  'unsigned int': (reader) => reader.u32(),
  UInt32: (reader) => reader.u32(),
  'Type*': (reader) => reader.u32(),
  'long long': (reader) => reader.i64(),
  SInt64: (reader) => reader.i64(),
  'unsigned long long': (reader) => reader.u64(),
  UInt64: (reader) => reader.u64(),
  FileSize: (reader) => reader.u64(),
  float: (reader) => reader.float(),
  double: (reader) => reader.double(),
  bool: (reader) => reader.boolean(),
};

export class SerializedFile {
  readonly fileVersion: number;
  readonly unityVersion: string;
  readonly targetPlatform: number;
  readonly types: SerializedType[];
  readonly objects: SerializedObject[];

  private constructor(
    private readonly reader: ByteReader,
    header: {
      version: number;
      unityVersion: string;
      targetPlatform: number;
      enableTypeTree: boolean;
    },
    types: SerializedType[],
    objects: SerializedObject[],
  ) {
    this.fileVersion = header.version;
    this.unityVersion = header.unityVersion;
    this.targetPlatform = header.targetPlatform;
    this.types = types;
    this.objects = objects;
  }

  static open(data: Uint8Array): SerializedFile {
    const reader = new ByteReader(data, 'be');

    reader.u32(); // Metadata size
    reader.u32(); // Total file size
    const version = reader.u32();
    reader.u32(); // Data offset (repeated explicitly for version >= 22)

    if (version < 9) throw new Error(`Unsupported serialized file version ${version}`);

    const endian: Endian = reader.boolean() ? 'be' : 'le';
    reader.readBytes(3); // Reserved

    let dataOffset = 0;
    if (version >= 22) {
      reader.u32(); // Metadata size
      reader.i64(); // Total file size
      dataOffset = reader.i64();
      reader.i64(); // Unknown
    }
    reader.setEndian(endian);

    const unityVersion = version >= 7 ? reader.stringToNull() : '';
    const targetPlatform = version >= 8 ? reader.i32() : -1;
    const enableTypeTree = version >= 13 ? reader.boolean() : true;

    const typeCount = reader.i32();
    const types: SerializedType[] = [];
    for (let i = 0; i < typeCount; i++) {
      types.push(readSerializedType(reader, version, enableTypeTree, false));
    }

    if (version >= 7 && version < 14) {
      throw new Error(`Unsupported serialized file version ${version} (14+ is required)`);
    }

    const objectCount = reader.i32();
    const objects: SerializedObject[] = [];
    for (let i = 0; i < objectCount; i++) {
      if (version >= 14) reader.align(HEADER_ALIGNMENT);
      const pathId = reader.i64();
      let byteStart = version >= 22 ? reader.i64() : reader.u32();
      byteStart += dataOffset;
      const byteSize = reader.u32();
      const typeId = reader.i32();
      const type = version < 16 ? types.find((t) => t.classId === typeId) : types[typeId];
      if (!type) throw new Error(`Serialized file object #${i} references unknown type ${typeId}`);
      objects.push({ pathId, byteStart, byteSize, typeId, type });
    }

    return new SerializedFile(
      reader,
      { version, unityVersion, targetPlatform, enableTypeTree },
      types,
      objects,
    );
  }

  objectsOfClass(classId: number): SerializedObject[] {
    return this.objects.filter((object) => object.type.classId === classId);
  }

  /** Walks the embedded type tree of an object and returns its plain values. */
  readTypetree(object: SerializedObject): TypetreeValue {
    const node = object.type.node;
    if (!node) throw new Error(`Object ${object.pathId} has no type tree`);

    const saved = this.reader.position;
    try {
      this.reader.position = object.byteStart;
      return readTypetreeValue(node, this.reader);
    } finally {
      this.reader.position = saved;
    }
  }

  /**
   * Reads a `TextAsset`: `m_Name` plus the raw `m_Script` payload.
   *
   * `m_Script` is a Unity `string` in current bundles (and was a `TypelessData`
   * blob in older ones); both are `int32 length` + bytes, so the payload is
   * always taken as raw bytes instead of going through UTF-8 decoding.
   */
  readTextAsset(object: SerializedObject): { name: string; script: Uint8Array } {
    if (object.type.classId !== ClassId.TextAsset) {
      throw new Error(`Object ${object.pathId} is not a TextAsset`);
    }

    const scriptNode = object.type.node?.children.find((child) => child.name === 'm_Script');
    const scriptIsString = scriptNode ? scriptNode.type === 'string' : true;

    const saved = this.reader.position;
    try {
      this.reader.position = object.byteStart;
      const name = readAlignedString(this.reader);
      const length = this.reader.i32();
      if (length < 0) throw new Error(`TextAsset ${object.pathId} has a negative payload length`);
      const script = this.reader.readBytes(length).slice();
      if (scriptIsString) this.reader.align(HEADER_ALIGNMENT);
      return { name, script };
    } finally {
      this.reader.position = saved;
    }
  }
}

/**
 * Whether a serialized type carries a script id before its old type hash.
 *
 * Unity's three ways to say "this type is backed by a script": a reference type
 * with a script index, a pre-16 file that flags it with a negative class id, and
 * a v16+ file whose type is a MonoBehaviour.
 */
function hasScriptId(
  version: number,
  classId: number,
  isRefType: boolean,
  scriptTypeIndex: number,
): boolean {
  if (isRefType && scriptTypeIndex >= 0) return true;
  return version < 16 ? classId < 0 : classId === ClassId.MonoBehaviour;
}

function readSerializedType(
  reader: ByteReader,
  version: number,
  enableTypeTree: boolean,
  isRefType: boolean,
): SerializedType {
  const classId = reader.i32();
  const isStripped = version >= 16 ? reader.boolean() : false;
  const scriptTypeIndex = version >= 17 ? reader.i16() : -1;

  if (version >= 13) {
    if (hasScriptId(version, classId, isRefType, scriptTypeIndex)) {
      reader.readBytes(HASH128_SIZE); // Script id
    }
    reader.readBytes(HASH128_SIZE); // Old type hash
  }

  let node: TypeTreeNode | null = null;
  if (enableTypeTree) {
    if (version >= 12 || version === 10) {
      node = readBlobTypetree(reader, version);
    } else {
      throw new Error(`Unsupported type tree encoding for serialized file version ${version}`);
    }
  }

  if (version >= 21) {
    if (isRefType) {
      reader.stringToNull();
      reader.stringToNull();
      reader.stringToNull();
    } else {
      const dependencyCount = reader.i32();
      for (let i = 0; i < dependencyCount; i++) reader.i32();
    }
  }

  return { classId, isStripped, scriptTypeIndex, node };
}

/**
 * Decodes the compact ("blob") type tree encoding: a fixed-size node table plus
 * a string buffer that both type and field names point into. Strings may also be
 * references into Unity's shared common-string table (`unity-common-strings.ts`);
 * an offset missing from that table is reported instead of silently producing
 * garbage names.
 */
function readBlobTypetree(reader: ByteReader, version: number): TypeTreeNode {
  const nodeCount = reader.i32();
  const stringBufferSize = reader.i32();

  const hasRefTypeHash = version >= 19;
  const nodeSize = hasRefTypeHash ? 32 : 24;
  const rawNodes = new ByteReader(reader.readBytes(nodeCount * nodeSize), reader.currentEndian, 0);
  const strings = new ByteReader(reader.readBytes(stringBufferSize), reader.currentEndian, 0);

  const readString = (value: number): string => {
    if ((value & 0x80000000) === 0) {
      const saved = strings.position;
      strings.position = value;
      const text = strings.stringToNull();
      strings.position = saved;
      return text;
    }
    const common = lookupCommonString(value & 0x7fffffff);
    if (common === undefined) {
      throw new Error(
        `Type tree references an unknown offset ${value & 0x7fffffff} in Unity's ` +
          'common-string table; the table needs refreshing for this client build',
      );
    }
    return common;
  };

  const root: TypeTreeNode = {
    version: 0,
    level: -1,
    typeFlags: 0,
    type: '',
    name: '',
    byteSize: 0,
    index: 0,
    metaFlag: 0,
    children: [],
  };

  const stack: TypeTreeNode[] = [root];
  let parent = root;
  let previous = root;

  for (let i = 0; i < nodeCount; i++) {
    const node: TypeTreeNode = {
      version: rawNodes.i16(),
      level: rawNodes.u8(),
      typeFlags: rawNodes.u8(),
      type: readString(rawNodes.u32()),
      name: readString(rawNodes.u32()),
      byteSize: rawNodes.i32(),
      index: rawNodes.i32(),
      metaFlag: rawNodes.i32(),
      children: [],
    };
    if (hasRefTypeHash) rawNodes.i64();

    if (node.level > previous.level) {
      stack.push(parent);
      parent = previous;
    } else if (node.level < previous.level) {
      while (stack.length > 0 && node.level <= parent.level) {
        parent = stack.pop() as TypeTreeNode;
      }
    }

    parent.children.push(node);
    previous = node;
  }

  const first = root.children[0];
  if (!first) throw new Error('Empty type tree blob');
  return first;
}

const ALIGN_BYTES = 0x4000;

function isAligned(metaFlag: number): boolean {
  return (metaFlag & ALIGN_BYTES) !== 0;
}

/** Recursive value reader mirroring Unity's serialization order. */
function readTypetreeValue(node: TypeTreeNode, reader: ByteReader): TypetreeValue {
  let align = isAligned(node.metaFlag);
  let value: TypetreeValue;

  const [first] = node.children;
  const primitive = PRIMITIVES[node.type];
  if (primitive) {
    value = primitive(reader);
  } else if (node.type === 'string') {
    value = readAlignedString(reader);
  } else if (node.type === 'TypelessData') {
    const length = reader.i32();
    value = reader.readBytes(length);
  } else if (first?.type === 'Array') {
    if (isAligned(first.metaFlag)) align = true;
    const size = reader.i32();
    if (size < 0) throw new Error(`Negative array length ${size} in type tree`);
    const subtype = first.children[1];
    if (!subtype) throw new Error('Malformed vector node in type tree');
    const elementPrimitive = PRIMITIVES[subtype.type];
    if (isAligned(subtype.metaFlag) || !elementPrimitive) {
      value = Array.from({ length: size }, () => readTypetreeValue(subtype, reader));
    } else {
      value = Array.from({ length: size }, () => elementPrimitive(reader));
    }
  } else {
    const record: Record<string, TypetreeValue> = {};
    for (const child of node.children) {
      record[child.name] = readTypetreeValue(child, reader);
    }
    value = record;
  }

  if (align) reader.align(HEADER_ALIGNMENT);
  return value;
}

function readAlignedString(reader: ByteReader): string {
  const length = reader.i32();
  if (length <= 0) return '';
  const text = Buffer.from(reader.readBytes(length)).toString('utf8');
  reader.align(HEADER_ALIGNMENT);
  return text;
}
