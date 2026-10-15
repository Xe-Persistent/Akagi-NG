/**
 * LZ4 block decompression, used by UnityFS bundles for both the block table and
 * the data blocks themselves (compression flags 2 = LZ4, 3 = LZ4HC).
 *
 * The LZ4 block format is a sequence of "token, literals, offset, match" runs;
 * see https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md. Only the
 * decoder is needed here, so this stays a small, dependency-free implementation.
 */
export function decompressLz4Block(source: Uint8Array, expectedSize: number): Uint8Array {
  const output = new Uint8Array(expectedSize);
  let read = 0;
  let written = 0;

  while (read < source.length) {
    const token = source[read++];

    let literalLength = token >> 4;
    if (literalLength === 15) {
      for (;;) {
        if (read >= source.length) throw new Error('LZ4: truncated literal length');
        const extra = source[read++];
        literalLength += extra;
        if (extra !== 255) break;
      }
    }

    if (read + literalLength > source.length) throw new Error('LZ4: truncated literal run');
    if (written + literalLength > expectedSize) throw new Error('LZ4: output overflow');
    output.set(source.subarray(read, read + literalLength), written);
    read += literalLength;
    written += literalLength;

    // The final sequence of a block holds literals only.
    if (read >= source.length) break;
    if (read + 2 > source.length) throw new Error('LZ4: truncated match offset');

    const offset = source[read] | (source[read + 1] << 8);
    read += 2;
    if (offset === 0 || offset > written) throw new Error(`LZ4: invalid match offset ${offset}`);

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      for (;;) {
        if (read >= source.length) throw new Error('LZ4: truncated match length');
        const extra = source[read++];
        matchLength += extra;
        if (extra !== 255) break;
      }
    }
    matchLength += 4;

    if (written + matchLength > expectedSize) throw new Error('LZ4: output overflow');
    // Byte-by-byte on purpose: matches may overlap the bytes they produce.
    const matchStart = written - offset;
    for (let i = 0; i < matchLength; i++) {
      output[written + i] = output[matchStart + i];
    }
    written += matchLength;
  }

  if (written !== expectedSize) {
    throw new Error(`LZ4: decoded ${written} byte(s), expected ${expectedSize}`);
  }
  return output;
}
