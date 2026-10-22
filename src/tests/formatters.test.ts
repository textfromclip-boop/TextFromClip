import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  formatSrtTimestamp,
  formatVttTimestamp,
  generateSrt,
  generateVtt,
  unescapeHtml,
} from '../server/utils/formatters';
import { TranscriptSegment } from '../types';

describe('Formatters & Subtitle Generators', () => {
  it('formats display timestamps accurately', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(12.4)).toBe('00:12');
    expect(formatTimestamp(65.8)).toBe('01:05');
    expect(formatTimestamp(3665)).toBe('01:01:05');
  });

  it('formats SRT and VTT millisecond timestamps', () => {
    expect(formatSrtTimestamp(1.234)).toBe('00:00:01,234');
    expect(formatVttTimestamp(1.234)).toBe('00:00:01.234');
    expect(formatSrtTimestamp(3665.5)).toBe('01:01:05,500');
    expect(formatVttTimestamp(3665.5)).toBe('01:01:05.500');
  });

  it('generates valid SubRip (.srt) subtitles', () => {
    const segments: TranscriptSegment[] = [
      { id: 1, start: 0.0, duration: 2.5, text: 'Hello world' },
      { id: 2, start: 2.5, duration: 3.0, text: 'Welcome to TextFromClip' },
    ];

    const srt = generateSrt(segments);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello world');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,500\nWelcome to TextFromClip');
  });

  it('generates valid WebVTT (.vtt) subtitles with header', () => {
    const segments: TranscriptSegment[] = [
      { id: 1, start: 0.0, duration: 2.5, text: 'Hello world' },
    ];

    const vtt = generateVtt(segments);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('1\n00:00:00.000 --> 00:00:02.500\nHello world');
  });

  it('unescapes HTML entities in caption strings', () => {
    expect(unescapeHtml('&quot;Hello&quot; &amp; welcome &#39;friend&#39;')).toBe('"Hello" & welcome \'friend\'');
    expect(unescapeHtml('Rock &amp; Roll')).toBe('Rock & Roll');
    expect(unescapeHtml('tag &lt;b&gt;bold&lt;/b&gt;')).toBe('tag <b>bold</b>');
  });
});
