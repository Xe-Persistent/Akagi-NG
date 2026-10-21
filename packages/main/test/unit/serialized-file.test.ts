/**
 * A `CAB-...` entry inside a bundle is a Unity SerializedFile. These tests build
 * one: the header, a type table with an embedded type tree, and an object table
 * pointing at a `TextAsset`. Getting the table wrong is how a real bundle starts
 * being read as garbage, so the shape is spelled out here rather than mocked.
 */
import { describe, expect, it } from 'vitest';

import { ClassId, SerializedFile } from '../../src/protocol/bootstrap/serialized-file.js';
import { BinaryWriter } from '../binary-writer.js';

const VERSION = 21;
const HASH128 = 16;

/** One type-tree node in the compact ("blob") encoding, version 19 and up. */
interface Node {
  version?: number;
  level: number;
  typeFlags?: number;
  type: number;
  name: number;
  byteSize?: number;
  index?: number;
  metaFlag?: number;
}

const encoder = new TextEncoder();

/** A string buffer plus the offsets the nodes point into it. */
function stringBuffer(...values: string[]) {
  const writer = new BinaryWriter();
  const offsets = new Map<string, number>();
  for (const value of values) {
    offsets.set(value, writer.length);
    writer.cstring(value);
  }
  return { bytes: writer.finish(), offsets };
}

function typeTree(nodes: Node[], strings: Uint8Array) {
  const writer = new BinaryWriter().i32(nodes.length).i32(strings.length);
  for (const node of nodes) {
    writer
      .i16(node.version ?? 1)
      .u8(node.level)
      .u8(node.typeFlags ?? 0)
      .u32(node.type)
      .u32(node.name)
      .i32(node.byteSize ?? -1)
      .i32(node.index ?? 0)
      .i32(node.metaFlag ?? 0)
      .i64(0); // ref type hash, present from version 19
  }
  return writer.raw(strings).finish();
}

/** A `TextAsset` type tree: the object name and the payload, both strings. */
function textAssetTree(rootName?: number) {
  const { bytes, offsets } = stringBuffer('TextAsset', 'base', 'string', 'm_Name', 'm_Script');
  const at = (value: string) => offsets.get(value)!;

  return typeTree(
    [
      { level: 0, type: at('TextAsset'), name: rootName ?? at('base') },
      { level: 1, type: at('string'), name: at('m_Name') },
      { level: 1, type: at('string'), name: at('m_Script') },
    ],
    bytes,
  );
}

interface BuildOptions {
  version?: number;
  classId?: number;
  tree?: Uint8Array;
  /** Overrides the payload bytes written after the aligned name. */
  payload?: string;
  typeId?: number;
}

/** A minimal file with one type and one object, both big-endian. */
function serializedFile(options: BuildOptions = {}) {
  const version = options.version ?? VERSION;
  const classId = options.classId ?? ClassId.TextAsset;

  const payload = encoder.encode(options.payload ?? 'return 1');

  // The object's own bytes: an aligned string name, then the payload.
  const body = new BinaryWriter().i32('a'.length).string('a').align().i32(payload.length);
  body.raw(payload).align();
  const objectBytes = body.finish();

  const header = new BinaryWriter()
    .u32(0) // metadata size
    .u32(0) // total file size
    .u32(version)
    .u32(0) // data offset, repeated for version 22 and up
    .u8(1) // big-endian from here on
    .raw(new Uint8Array(3)) // reserved
    .cstring('2022.3.0f1')
    .i32(19) // target platform
    .u8(1); // type trees enabled

  const types = new BinaryWriter().i32(1);
  types.i32(classId); // class id
  if (version >= 16) types.u8(0); // is stripped
  if (version >= 17) types.i16(-1); // script type index
  if (version >= 13) types.raw(new Uint8Array(HASH128)); // old type hash
  if (version >= 12) types.raw(options.tree ?? textAssetTree());
  if (version >= 21) types.i32(0); // dependency count

  const headerBytes = header.finish();
  const typesBytes = types.finish();

  // The object count is read where the type table ends; each entry after it is
  // aligned to four bytes from the start of the file.
  const objects = new BinaryWriter().i32(1);
  const padding = (4 - ((headerBytes.length + typesBytes.length + objects.length) % 4)) % 4;
  objects.raw(new Uint8Array(padding));
  const entryStart = objects.length;
  objects.i64(1); // path id
  objects.u32(0); // byte start, filled in below
  objects.u32(objectBytes.length); // byte size
  objects.i32(options.typeId ?? 0);

  const byteStart = headerBytes.length + typesBytes.length + entryStart + 20;
  const objectsBytes = objects.finish();
  new DataView(objectsBytes.buffer, objectsBytes.byteOffset).setUint32(entryStart + 8, byteStart);

  return new BinaryWriter()
    .raw(headerBytes)
    .raw(typesBytes)
    .raw(objectsBytes)
    .raw(objectBytes)
    .finish();
}

describe('a serialized file', () => {
  it('reads the header', () => {
    const file = SerializedFile.open(serializedFile());

    expect(file.fileVersion).toBe(VERSION);
    expect(file.unityVersion).toBe('2022.3.0f1');
    expect(file.targetPlatform).toBe(19);
    expect(file.types).toHaveLength(1);
    expect(file.types[0]).toMatchObject({ classId: ClassId.TextAsset, isStripped: false });
  });

  it('finds the type tree children of an object', () => {
    const file = SerializedFile.open(serializedFile());
    const node = file.types[0]!.node;

    expect(node?.children.map((child) => child.name)).toEqual(['m_Name', 'm_Script']);
  });

  it('reads a TextAsset payload as raw bytes', () => {
    const file = SerializedFile.open(serializedFile({ payload: 'local x = 1' }));
    const [asset] = file.objectsOfClass(ClassId.TextAsset);

    const read = file.readTextAsset(asset!);

    expect(read.name).toBe('a');
    expect(new TextDecoder().decode(read.script)).toBe('local x = 1');
  });

  it('walks the type tree into plain values', () => {
    const file = SerializedFile.open(serializedFile({ payload: 'local x = 1' }));
    const [asset] = file.objectsOfClass(ClassId.TextAsset);

    expect(file.readTypetree(asset!)).toEqual({ m_Name: 'a', m_Script: 'local x = 1' });
  });

  it('resolves a name through the common-string table', () => {
    // A high bit turns the offset into an index into Unity's shared table,
    // which holds "AABB" at offset zero.
    const file = SerializedFile.open(serializedFile({ tree: textAssetTree(0x80000000) }));

    expect(file.types[0]!.node?.name).toBe('AABB');
  });

  it('reports a common-string offset the table does not hold', () => {
    const { bytes, offsets } = stringBuffer('TextAsset', 'base', 'string', 'm_Name', 'm_Script');
    const tree = typeTree(
      [
        { level: 0, type: offsets.get('TextAsset')!, name: 0x80000000 | 999_999 },
        { level: 1, type: offsets.get('string')!, name: offsets.get('m_Name')! },
      ],
      bytes,
    );

    expect(() => SerializedFile.open(serializedFile({ tree }))).toThrow('unknown offset 999999');
  });

  it('rejects an empty type tree', () => {
    expect(() =>
      SerializedFile.open(serializedFile({ tree: typeTree([], new Uint8Array()) })),
    ).toThrow('Empty type tree blob');
  });

  it('rejects a version it cannot parse', () => {
    expect(() => SerializedFile.open(serializedFile({ version: 8 }))).toThrow(
      'Unsupported serialized file version 8',
    );
    expect(() => SerializedFile.open(serializedFile({ version: 13 }))).toThrow(
      'Unsupported serialized file version 13 (14+ is required)',
    );
  });

  it('rejects an object that points at a type it does not have', () => {
    expect(() => SerializedFile.open(serializedFile({ typeId: 7 }))).toThrow(
      'references unknown type 7',
    );
  });

  it('refuses to read a non-TextAsset as one', () => {
    const file = SerializedFile.open(
      serializedFile({ classId: ClassId.MonoScript, tree: textAssetTree() }),
    );
    const [object] = file.objects;

    expect(() => file.readTextAsset(object!)).toThrow('is not a TextAsset');
  });
});
