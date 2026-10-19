import { ByteReader } from './byte-reader.js';
import { decompressLz4Block } from './lz4.js';

/**
 * Minimal UnityFS (asset bundle) container reader.
 *
 * Layout (UnityFS, version >= 7):
 *   signature "UnityFS\0", version, unity version, unity revision,
 *   total size, compressed/uncompressed blocks-info sizes, flags,
 *   16-byte alignment, [blocks info (+ directory info)], 16-byte alignment,
 *   compressed data blocks.
 *
 * Only the pieces the protocol bootstrap needs are implemented: the block table,
 * the directory, and LZ4/LZ4HC (and stored) block decompression. LZMA blocks are
 * reported as an explicit error instead of being silently mis-parsed.
 */
const SIGNATURE = 'UnityFS';

const COMPRESSION_MASK = 0x3f;
const COMPRESSION_NONE = 0;
const COMPRESSION_LZMA = 1;
const COMPRESSION_LZ4 = 2;
const COMPRESSION_LZ4HC = 3;

const FLAG_BLOCKS_INFO_AT_THE_END = 0x80;
const FLAG_BLOCK_INFO_NEED_PADDING_AT_START = 0x200;

const BLOCKS_INFO_ALIGNMENT = 16;
const UNCOMPRESSED_DATA_HASH_SIZE = 16;
const BLOCK_ENTRY_SIZE = 10;

interface BlockInfo {
  uncompressedSize: number;
  compressedSize: number;
  flags: number;
}

interface DirectoryNode {
  path: string;
  offset: number;
  size: number;
}

export class UnityFsBundle {
  private constructor(private readonly entries: Map<string, Uint8Array>) {}

  /** Parses the whole bundle up front; the bundles used here are a few MB at most. */
  static open(data: Uint8Array): UnityFsBundle {
    const reader = new ByteReader(data, 'be');

    const signature = reader.stringToNull();
    if (signature !== SIGNATURE) {
      throw new Error(`Not a UnityFS bundle (signature "${signature}")`);
    }

    const version = reader.u32();
    reader.stringToNull(); // Web bundle version, e.g. "5.x.x"
    reader.stringToNull(); // Engine revision, e.g. "0.0.0" for this game
    reader.i64(); // Total bundle size
    const compressedBlocksInfoSize = reader.u32();
    const uncompressedBlocksInfoSize = reader.u32();
    const flags = reader.u32();

    if (version >= 7) reader.align(BLOCKS_INFO_ALIGNMENT);

    const compression = flags & COMPRESSION_MASK;

    let blocksInfo: Uint8Array;
    if (flags & FLAG_BLOCKS_INFO_AT_THE_END) {
      const resume = reader.position;
      reader.position = reader.length - compressedBlocksInfoSize;
      blocksInfo = decompress(
        reader.readBytes(compressedBlocksInfoSize),
        uncompressedBlocksInfoSize,
        compression,
        'blocks info',
      );
      reader.position = resume;
    } else {
      blocksInfo = decompress(
        reader.readBytes(compressedBlocksInfoSize),
        uncompressedBlocksInfoSize,
        compression,
        'blocks info',
      );
    }

    if (flags & FLAG_BLOCK_INFO_NEED_PADDING_AT_START) {
      reader.align(BLOCKS_INFO_ALIGNMENT);
    }

    const info = new ByteReader(blocksInfo, 'be');
    info.readBytes(UNCOMPRESSED_DATA_HASH_SIZE);

    const blockCount = info.i32();
    if (blockCount < 0) throw new Error(`Invalid UnityFS block count ${blockCount}`);
    const blocks: BlockInfo[] = [];
    for (let i = 0; i < blockCount; i++) {
      blocks.push({
        uncompressedSize: info.u32(),
        compressedSize: info.u32(),
        flags: info.u16(),
      });
    }
    if (info.position !== UNCOMPRESSED_DATA_HASH_SIZE + 4 + blockCount * BLOCK_ENTRY_SIZE) {
      throw new Error('Unexpected UnityFS block table size');
    }

    const nodeCount = info.i32();
    if (nodeCount < 0) throw new Error(`Invalid UnityFS directory size ${nodeCount}`);
    const nodes: DirectoryNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const offset = info.i64();
      const size = info.i64();
      info.u32(); // Node flags (compression/resource kind), unused here
      nodes.push({ path: info.stringToNull(), offset, size });
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    for (const block of blocks) {
      const raw = reader.readBytes(block.compressedSize);
      const chunk = decompress(
        raw,
        block.uncompressedSize,
        block.flags & COMPRESSION_MASK,
        'data block',
      );
      chunks.push(chunk);
      totalSize += chunk.length;
    }
    const payload = concat(chunks, totalSize);

    const entries = new Map<string, Uint8Array>();
    for (const node of nodes) {
      if (node.offset + node.size > payload.length) {
        throw new Error(
          `UnityFS entry "${node.path}" points outside the data region ` +
            `(${node.offset}+${node.size} > ${payload.length})`,
        );
      }
      entries.set(node.path, payload.subarray(node.offset, node.offset + node.size));
    }

    return new UnityFsBundle(entries);
  }

  listEntryPaths(): string[] {
    return [...this.entries.keys()];
  }

  readEntry(path: string): Uint8Array {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`UnityFS entry not found: ${path}`);
    return entry;
  }
}

function decompress(
  source: Uint8Array,
  expectedSize: number,
  compression: number,
  what: string,
): Uint8Array {
  switch (compression) {
    case COMPRESSION_NONE:
      if (source.length !== expectedSize) {
        throw new Error(
          `Uncompressed ${what} has ${source.length} byte(s), expected ${expectedSize}`,
        );
      }
      return source;
    case COMPRESSION_LZ4:
    case COMPRESSION_LZ4HC:
      return decompressLz4Block(source, expectedSize);
    case COMPRESSION_LZMA:
      throw new Error(
        `UnityFS ${what} uses LZMA compression, which is not supported (LZ4 is expected)`,
      );
    default:
      throw new Error(`Unknown UnityFS compression type ${compression} for the ${what}`);
  }
}

function concat(chunks: Uint8Array[], totalSize: number): Uint8Array {
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
