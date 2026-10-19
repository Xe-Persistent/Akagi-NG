import { describe, expect, it } from 'vitest';

import { ByteReader } from '../../src/protocol/bootstrap/byte-reader.js';

/** Bytes for a reader, written in the order given. */
const bytes = (...values: number[]) => Uint8Array.from(values);

describe('the byte reader', () => {
  it('reads big-endian by default', () => {
    const reader = new ByteReader(bytes(0x12, 0x34));

    expect(reader.u16()).toBe(0x1234);
    expect(reader.position).toBe(2);
  });

  it('reads little-endian once switched', () => {
    const reader = new ByteReader(bytes(0x34, 0x12), 'le');

    expect(reader.u16()).toBe(0x1234);
  });

  it('can switch byte order mid-stream', () => {
    const reader = new ByteReader(bytes(0x00, 0x2a, 0x2a, 0x00));

    expect(reader.u16()).toBe(42);
    reader.setEndian('le');
    expect(reader.u16()).toBe(42);
  });

  it('reads every signed and unsigned width', () => {
    const reader = new ByteReader(
      bytes(
        0xff, // u8 / i8
        0xff,
        0xff, // u16 / i16
        0xff,
        0xff,
        0xff,
        0xfe, // u32
        0xff,
        0xff,
        0xff,
        0xfe, // i32
      ),
    );

    expect(reader.u8()).toBe(255);
    reader.position = 0;
    expect(reader.i8()).toBe(-1);
    reader.position = 1;
    expect(reader.u16()).toBe(0xffff);
    reader.position = 1;
    expect(reader.i16()).toBe(-1);
    reader.position = 3;
    expect(reader.u32()).toBe(0xfffffffe);
    reader.position = 3;
    expect(reader.i32()).toBe(-2);
  });

  it('keeps 64-bit sizes exact', () => {
    const reader = new ByteReader(
      bytes(0, 0, 0, 0, 0, 0, 0x01, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
    );

    expect(reader.i64()).toBe(256);
    // 2^64-1 goes through Number, which rounds it; Unity's file sizes are far
    // below that, which is what the reader relies on.
    expect(reader.u64()).toBe(Number(0xffffffffffffffffn));
  });

  it('reads floats and doubles', () => {
    const buffer = new Uint8Array(12);
    new DataView(buffer.buffer).setFloat32(0, 1.5);
    new DataView(buffer.buffer).setFloat64(4, -0.25);

    const reader = new ByteReader(buffer);

    expect(reader.float()).toBe(1.5);
    expect(reader.double()).toBe(-0.25);
  });

  it('reads a flag as a boolean', () => {
    const reader = new ByteReader(bytes(0, 1, 2));

    expect(reader.boolean()).toBe(false);
    expect(reader.boolean()).toBe(true);
    expect(reader.boolean()).toBe(true);
  });

  it('aligns the cursor the way Unity pads', () => {
    const reader = new ByteReader(bytes(1, 2, 3, 4, 5, 6, 7, 8));

    reader.align(4);
    expect(reader.position).toBe(0);
    reader.u8();
    reader.align(4);
    expect(reader.position).toBe(4);
    reader.align(4);
    expect(reader.position).toBe(4);
  });

  it('reads a null-terminated string and steps over the terminator', () => {
    const reader = new ByteReader(Uint8Array.from([...Buffer.from('5.x.x'), 0, 0x2a]));

    expect(reader.stringToNull()).toBe('5.x.x');
    expect(reader.u8()).toBe(0x2a);
  });

  it('hands out a view and advances', () => {
    const reader = new ByteReader(bytes(1, 2, 3, 4));

    expect(Array.from(reader.readBytes(2))).toEqual([1, 2]);
    expect(reader.position).toBe(2);
    expect(Array.from(reader.readBytes(2))).toEqual([3, 4]);
    expect(reader.position).toBe(4);
  });

  it('refuses to read past the end', () => {
    const reader = new ByteReader(bytes(1, 2));

    reader.u16();

    expect(() => reader.u16()).toThrow(
      /Unexpected end of data: tried to read 2 byte\(s\) at 2 of 2/,
    );
  });

  it('reports its length and endianness', () => {
    const reader = new ByteReader(bytes(1, 2, 3), 'le', 1);

    expect(reader.length).toBe(3);
    expect(reader.currentEndian).toBe('le');
    expect(reader.position).toBe(1);
    expect(reader.u8()).toBe(2);
  });
});
