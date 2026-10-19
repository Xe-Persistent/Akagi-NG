/**
 * A byte writer for the binary formats the protocol bootstrap reads. Unity's
 * containers are big-endian, so that is the only order offered here.
 */
export class BinaryWriter {
  private readonly parts: number[] = [];

  get length() {
    return this.parts.length;
  }

  u8(value: number) {
    this.parts.push(value & 0xff);
    return this;
  }

  i8(value: number) {
    return this.u8(value);
  }

  u16(value: number) {
    return this.u8(value >> 8).u8(value);
  }

  i16(value: number) {
    return this.u16(value & 0xffff);
  }

  u32(value: number) {
    return this.u8(value >>> 24)
      .u8(value >>> 16)
      .u8(value >>> 8)
      .u8(value);
  }

  i32(value: number) {
    return this.u32(value >>> 0);
  }

  i64(value: number) {
    return this.u32(Math.floor(value / 2 ** 32)).u32(value % 2 ** 32);
  }

  raw(bytes: Uint8Array) {
    for (const byte of bytes) this.u8(byte);
    return this;
  }

  string(value: string) {
    return this.raw(new TextEncoder().encode(value));
  }

  cstring(value: string) {
    return this.string(value).u8(0);
  }

  align(alignment = 4) {
    while (this.parts.length % alignment !== 0) this.u8(0);
    return this;
  }

  finish() {
    return Uint8Array.from(this.parts);
  }
}
