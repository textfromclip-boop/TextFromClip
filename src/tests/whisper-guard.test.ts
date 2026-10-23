import { describe, it, expect } from 'vitest';
import { looksLikeWhisperHallucination } from '../server/utils/whisper-fallback';

describe('Whisper hallucination guard', () => {
  it('flags looping filler like "hey hey hey"', () => {
    expect(looksLikeWhisperHallucination(Array(60).fill('Hey,').join(' '))).toBe(true);
  });

  it('flags a single endless token', () => {
    expect(looksLikeWhisperHallucination('UJ'.repeat(80))).toBe(true);
  });

  it('flags very low variety text', () => {
    expect(looksLikeWhisperHallucination(Array(40).fill('oh yeah').join(' '))).toBe(true);
  });

  it('keeps real speech, including short and repetitive-but-genuine lines', () => {
    expect(
      looksLikeWhisperHallucination(
        "What country has the most silverback gorillas? Morocco. No. Brazil. No. New Guinea. No. Tanzania. Number two is Rwanda, and the Congo is number one."
      )
    ).toBe(false);
    expect(looksLikeWhisperHallucination('Would you look at that, ma am? Wow.')).toBe(false);
    expect(looksLikeWhisperHallucination('No. No. No.')).toBe(false);
  });
});

