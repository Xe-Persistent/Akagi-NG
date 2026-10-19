import { describe, expect, it } from 'vitest';

import { decompressLz4Block } from '../../src/protocol/bootstrap/lz4.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

/**
 * A block is a run of sequences: `token` (literal length in the high nibble,
 * match length - 4 in the low nibble), the literals, then a two-byte match
 * offset. A nibble of 15 means the length continues in following bytes.
 */
describe('an LZ4 block', () => {
  it('copies a run of literals', () => {
    // 3 literals, no match: the last sequence of a block holds literals only.
    expect(text(decompressLz4Block(Uint8Array.from([0x30, ...ascii('abc')]), 3))).toBe('abc');
  });

  it('expands a match from the bytes already written', () => {
    // 4 literals "abcd", then a 4-byte match 4 bytes back.
    const block = Uint8Array.from([0x40, ...ascii('abcd'), 0x04, 0x00]);

    expect(text(decompressLz4Block(block, 8))).toBe('abcdabcd');
  });

  it('repeats a match that overlaps its own output', () => {
    // 1 literal "a", then a 4-byte match 1 byte back: every byte comes from the
    // byte just written, which is why the copy is byte by byte.
    expect(text(decompressLz4Block(Uint8Array.from([0x10, 0x61, 0x01, 0x00]), 5))).toBe('aaaaa');
  });

  it('continues a length that does not fit in the nibble', () => {
    // Literal length 15 + 255 + 21 = 291 for the token's high nibble of 15.
    const literals = ascii('x'.repeat(291));
    const block = Uint8Array.from([0xf0, 0xff, 21, ...literals]);

    expect(decompressLz4Block(block, 291)).toHaveLength(291);
  });

  it('continues a match length that does not fit in the nibble', () => {
    // 1 literal, match length 15 + 2 + 4 = 21 from offset 1.
    const block = Uint8Array.from([0x1f, 0x61, 0x01, 0x00, 2]);

    expect(text(decompressLz4Block(block, 22))).toBe('a'.repeat(22));
  });

  it('rejects a block that ends mid-length', () => {
    expect(() => decompressLz4Block(bytes(0xf0), 16)).toThrow('truncated literal length');
    expect(() => decompressLz4Block(Uint8Array.from([0x1f, 0x61, 0x01, 0x00]), 22)).toThrow(
      'truncated match length',
    );
  });

  it('rejects a literal run that runs off the end', () => {
    expect(() => decompressLz4Block(Uint8Array.from([0x50, 0x61, 0x62]), 5)).toThrow(
      'truncated literal run',
    );
  });

  it('rejects a match offset that points nowhere', () => {
    expect(() => decompressLz4Block(Uint8Array.from([0x10, 0x61, 0x00, 0x00]), 5)).toThrow(
      'invalid match offset 0',
    );
    expect(() => decompressLz4Block(Uint8Array.from([0x10, 0x61, 0x02, 0x00]), 5)).toThrow(
      'invalid match offset 2',
    );
    expect(() => decompressLz4Block(Uint8Array.from([0x10, 0x61, 0x01]), 5)).toThrow(
      'truncated match offset',
    );
  });

  it('rejects output that does not fit the expected size', () => {
    expect(() => decompressLz4Block(Uint8Array.from([0x30, 0x61, 0x62, 0x63]), 2)).toThrow(
      'output overflow',
    );
  });

  it('rejects a block that decodes to the wrong length', () => {
    // The output array is the declared size, so a short decode would silently
    // leave zeroes at the end unless it is treated as a failure.
    expect(() => decompressLz4Block(Uint8Array.from([0x30, 0x61, 0x62, 0x63]), 4)).toThrow(
      'decoded 3 byte(s), expected 4',
    );
  });
});
