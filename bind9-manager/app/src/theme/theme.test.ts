import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('auto defers to the OS preference', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('an explicit mode overrides the OS preference', () => {
    // The whole point of an explicit choice: it beats the OS. If resolveTheme
    // ever just returned prefersDark, this line would fail — the must-fail control.
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
