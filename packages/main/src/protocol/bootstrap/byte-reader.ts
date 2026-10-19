/**
 * Bounds-checked byte reader with switchable endianness.
 *
 * Unity mixes both byte orders inside a single bundle: the UnityFS header is
 * big-endian, while the serialized file it contains declares its own endianness
 * in its header and everything after that follows it.
 */
export type Endian = 'be' | 'le';

export class ByteReader {
  private readonly view: DataView;
  private cursor: number;
  private endian: Endian;

  constructor(
    readonly bytes: Uint8Array,
    endian: Endian = 'be',
    offset = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.endian = endian;
    this.cursor = offset;
  }

  get length(): number {
    return this.bytes.length;
  }

  get position(): number {
    return this.cursor;
  }

  set position(value: number) {
    this.cursor = value;
  }

  /** Current byte order, e.g. to hand it to a nested reader over a slice. */
  get currentEndian(): Endian {
    return this.endian;
  }

  setEndian(endian: Endian): void {
    this.endian = endian;
  }

  /** Pads the cursor to the next multiple of `alignment` (Unity aligns with zeroes). */
  align(alignment = 4): void {
    const remainder = this.cursor % alignment;
    if (remainder !== 0) this.cursor += alignment - remainder;
  }

  u8(): number {
    this.require(1);
    return this.view.getUint8(this.cursor++);
  }

  i8(): number {
    this.require(1);
    return this.view.getInt8(this.cursor++);
  }

  u16(): number {
    this.require(2);
    const value = this.view.getUint16(this.cursor, this.littleEndian);
    this.cursor += 2;
    return value;
  }

  i16(): number {
    this.require(2);
    const value = this.view.getInt16(this.cursor, this.littleEndian);
    this.cursor += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.cursor, this.littleEndian);
    this.cursor += 4;
    return value;
  }

  i32(): number {
    this.require(4);
    const value = this.view.getInt32(this.cursor, this.littleEndian);
    this.cursor += 4;
    return value;
  }

  /** 64-bit offsets and sizes stay exact: JS numbers cover Unity's file sizes. */
  i64(): number {
    this.require(8);
    const value = Number(this.view.getBigInt64(this.cursor, this.littleEndian));
    this.cursor += 8;
    return value;
  }

  u64(): number {
    this.require(8);
    const value = Number(this.view.getBigUint64(this.cursor, this.littleEndian));
    this.cursor += 8;
    return value;
  }

  boolean(): boolean {
    return this.u8() !== 0;
  }

  float(): number {
    this.require(4);
    const value = this.view.getFloat32(this.cursor, this.littleEndian);
    this.cursor += 4;
    return value;
  }

  double(): number {
    this.require(8);
    const value = this.view.getFloat64(this.cursor, this.littleEndian);
    this.cursor += 8;
    return value;
  }

  /** Returns a view into the underlying buffer; callers must not mutate it. */
  readBytes(count: number): Uint8Array {
    this.require(count);
    const value = this.bytes.subarray(this.cursor, this.cursor + count);
    this.cursor += count;
    return value;
  }

  stringToNull(): string {
    const start = this.cursor;
    while (this.cursor < this.bytes.length && this.bytes[this.cursor] !== 0) this.cursor++;
    const value = Buffer.from(this.bytes.subarray(start, this.cursor)).toString('utf8');
    this.cursor++; // skip the terminator
    return value;
  }

  private get littleEndian(): boolean {
    return this.endian === 'le';
  }

  private require(count: number): void {
    if (this.cursor + count > this.bytes.length) {
      throw new Error(
        `Unexpected end of data: tried to read ${count} byte(s) at ${this.cursor} ` +
          `of ${this.bytes.length}`,
      );
    }
  }
}
