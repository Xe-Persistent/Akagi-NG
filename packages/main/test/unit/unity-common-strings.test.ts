import { describe, expect, it } from 'vitest';

import {
  lookupCommonString,
  UNITY_COMMON_STRINGS,
} from '../../src/protocol/bootstrap/unity-common-strings.js';

describe("Unity's common string table", () => {
  it('lays the entries out with a NUL after each one', () => {
    // The offsets are computed, not stored, so this is the invariant that makes
    // the lookup table correct.
    const offsets = new Map<number, string>();
    let offset = 0;
    for (const entry of UNITY_COMMON_STRINGS) {
      offsets.set(offset, entry);
      offset += Buffer.byteLength(entry, 'utf8') + 1;
    }

    expect(offsets.size).toBe(UNITY_COMMON_STRINGS.length);
    for (const [each, entry] of offsets) expect(lookupCommonString(each)).toBe(entry);
  });

  it('starts at zero and resolves a later entry', () => {
    expect(lookupCommonString(0)).toBe(UNITY_COMMON_STRINGS[0]);

    const later = 5;
    const offset = UNITY_COMMON_STRINGS.slice(0, later).reduce(
      (sum, entry) => sum + Buffer.byteLength(entry, 'utf8') + 1,
      0,
    );
    expect(lookupCommonString(offset)).toBe(UNITY_COMMON_STRINGS[later]);
  });

  it('has no duplicate entries, which would make one of them unreachable', () => {
    expect(new Set(UNITY_COMMON_STRINGS).size).toBe(UNITY_COMMON_STRINGS.length);
  });

  it('returns undefined for an offset that is not an entry boundary', () => {
    expect(lookupCommonString(999_999)).toBeUndefined();
    expect(lookupCommonString(-1)).toBeUndefined();
  });
});
