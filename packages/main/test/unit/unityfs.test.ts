/**
 * The bundle reader is driven by a real UnityFS container, so these tests build
 * one byte by byte: get the header or the block table wrong and a real game
 * bundle stops loading.
 */
import { describe, expect, it } from 'vitest';

import { UnityFsBundle } from '../../src/protocol/bootstrap/unityfs.js';
import { BinaryWriter as Writer } from '../binary-writer.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SIGNATURE = 'UnityFS';
const VERSION = 7;
const ALIGNMENT = 16;

const COMPRESSION_NONE = 0;
const COMPRESSION_LZMA = 1;
const COMPRESSION_LZ4 = 2;

const FLAG_BLOCKS_INFO_AT_THE_END = 0x80;

interface Entry {
  path: string;
  data: string;
}

/** One stored (uncompressed) block holding every entry, back to back. */
function storedBlocksInfo(entries: Entry[]): Uint8Array {
  const writer = new Writer().raw(new Uint8Array(16)); // uncompressed data hash
  writer.i32(1); // one block
  const payload = entries.map((entry) => entry.data).join('');
  writer.u32(payload.length); // uncompressed size
  writer.u32(payload.length); // compressed size
  writer.u16(COMPRESSION_NONE);

  writer.i32(entries.length);
  let offset = 0;
  for (const entry of entries) {
    writer.i64(offset);
    writer.i64(entry.data.length);
    writer.u32(0); // node flags
    writer.cstring(entry.path);
    offset += entry.data.length;
  }

  return writer.finish();
}

function bundle(entries: Entry[], options: { atEnd?: boolean; compression?: number } = {}) {
  const blocksInfo = storedBlocksInfo(entries);
  const compression = options.compression ?? COMPRESSION_NONE;
  const payload = encoder.encode(entries.map((entry) => entry.data).join(''));

  const header = new Writer()
    .cstring(SIGNATURE)
    .u32(VERSION)
    .cstring('5.x.x')
    .cstring('0.0.0')
    .i64(0) // total size, not read back
    .u32(blocksInfo.length)
    .u32(blocksInfo.length)
    .u32((options.atEnd ? FLAG_BLOCKS_INFO_AT_THE_END : 0) | compression)
    .align(ALIGNMENT);

  const body = options.atEnd
    ? new Writer().raw(payload).raw(blocksInfo)
    : new Writer().raw(blocksInfo).raw(payload);

  return new Writer().raw(header.finish()).raw(body.finish()).finish();
}

/** A single LZ4 block of literals only: the simplest valid compressed block. */
function lz4Literals(value: string): Uint8Array {
  const bytes = encoder.encode(value);
  if (bytes.length >= 15) throw new Error('keep the literal run inside the token nibble');
  return Uint8Array.from([bytes.length << 4, ...bytes]);
}

describe('a UnityFS bundle', () => {
  it('lists and reads the entries of a stored bundle', () => {
    const data = bundle([
      { path: 'CAB-a', data: 'first' },
      { path: 'lua/liqi_struct_pb', data: 'second!' },
    ]);

    const parsed = UnityFsBundle.open(data);

    expect(parsed.listEntryPaths()).toEqual(['CAB-a', 'lua/liqi_struct_pb']);
    expect(decoder.decode(parsed.readEntry('CAB-a'))).toBe('first');
    expect(decoder.decode(parsed.readEntry('lua/liqi_struct_pb'))).toBe('second!');
  });

  it('reads a block table kept at the end of the bundle', () => {
    const data = bundle([{ path: 'a', data: 'payload' }], { atEnd: true });

    expect(decoder.decode(UnityFsBundle.open(data).readEntry('a'))).toBe('payload');
  });

  it('decompresses an LZ4 data block', () => {
    const content = 'hello';
    const compressed = lz4Literals(content);
    const writer = new Writer().raw(new Uint8Array(16));
    writer.i32(1); // one block
    writer.u32(content.length);
    writer.u32(compressed.length);
    writer.u16(COMPRESSION_LZ4);
    writer.i32(1); // one node
    writer.i64(0);
    writer.i64(content.length);
    writer.u32(0);
    writer.cstring('a');

    const header = new Writer()
      .cstring(SIGNATURE)
      .u32(VERSION)
      .cstring('5.x.x')
      .cstring('0.0.0')
      .i64(0)
      .u32(writer.length)
      .u32(writer.length)
      .u32(COMPRESSION_NONE)
      .align(ALIGNMENT);

    const data = new Writer().raw(header.finish()).raw(writer.finish()).raw(compressed).finish();

    expect(decoder.decode(UnityFsBundle.open(data).readEntry('a'))).toBe(content);
  });

  it('rejects something that is not a bundle', () => {
    expect(() => UnityFsBundle.open(encoder.encode('not a bundle at all'))).toThrow(
      'Not a UnityFS bundle',
    );
  });

  it('reports LZMA instead of guessing at it', () => {
    expect(() =>
      UnityFsBundle.open(bundle([{ path: 'a', data: 'x' }], { compression: COMPRESSION_LZMA })),
    ).toThrow('uses LZMA compression');
  });

  it('rejects an unknown compression type', () => {
    expect(() =>
      UnityFsBundle.open(bundle([{ path: 'a', data: 'x' }], { compression: 9 })),
    ).toThrow('Unknown UnityFS compression type 9');
  });

  it('rejects an entry that points outside the data region', () => {
    const blocksInfo = storedBlocksInfo([{ path: 'a', data: 'x' }]);
    // Declare the node two bytes longer than the payload that follows.
    const view = new DataView(blocksInfo.buffer, blocksInfo.byteOffset, blocksInfo.byteLength);
    view.setUint32(16 + 4 + 10 + 4 + 8 + 4, 99);

    const header = new Writer()
      .cstring(SIGNATURE)
      .u32(VERSION)
      .cstring('5.x.x')
      .cstring('0.0.0')
      .i64(0)
      .u32(blocksInfo.length)
      .u32(blocksInfo.length)
      .u32(COMPRESSION_NONE)
      .align(ALIGNMENT);

    const data = new Writer().raw(header.finish()).raw(blocksInfo).string('x').finish();

    expect(() => UnityFsBundle.open(data)).toThrow('points outside the data region');
  });

  it('refuses to read a path it does not hold', () => {
    const parsed = UnityFsBundle.open(bundle([{ path: 'a', data: 'x' }]));

    expect(() => parsed.readEntry('missing')).toThrow('UnityFS entry not found: missing');
  });
});
