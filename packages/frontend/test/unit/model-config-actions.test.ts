import { describe, expect, it } from 'vitest';

import { showsKeyEditor } from '@/components/settings/ApiKeyItem';
import { clampTimeoutSeconds } from '@/components/settings/OnlineAccountFields';

describe('the key row', () => {
  it('shows a field only while a key is actually being entered', () => {
    // Nothing stored: there is something to type.
    expect(showsKeyEditor(false, false)).toBe(true);
    // Stored and untouched: a summary, never an empty box dressed up as a value.
    expect(showsKeyEditor(true, false)).toBe(false);
  });

  it('shows the field again when the stored key is being replaced', () => {
    expect(showsKeyEditor(true, true)).toBe(true);
  });
});

describe('the decision timeout input', () => {
  it('keeps a value inside the range the service can honour', () => {
    expect(clampTimeoutSeconds('0.2', 3)).toBe(0.5);
    expect(clampTimeoutSeconds('-1', 3)).toBe(0.5);
    expect(clampTimeoutSeconds('9', 3)).toBe(3);
    expect(clampTimeoutSeconds('1.5', 3)).toBe(1.5);
    expect(clampTimeoutSeconds('0.5', 3)).toBe(0.5);
    expect(clampTimeoutSeconds('3', 3)).toBe(3);
  });

  it('falls back to the stored value when the field is not a number', () => {
    expect(clampTimeoutSeconds('', 2)).toBe(2);
    expect(clampTimeoutSeconds('abc', 2)).toBe(2);
    expect(clampTimeoutSeconds('  ', 1.5)).toBe(1.5);
  });
});
