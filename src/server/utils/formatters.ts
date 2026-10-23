import { TranscriptSegment } from '../../types';

/**
 * Format seconds into HH:MM:SS or MM:SS
 * e.g., 75.4 -> "01:15", 3665.2 -> "01:01:05"
 */
export function formatTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Format seconds into SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const pad = (n: number, w: number = 2) => n.toString().padStart(w, '0');

  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(millis, 3)}`;
}

/**
 * Format seconds into WebVTT timestamp: HH:MM:SS.mmm
 */
export function formatVttTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const pad = (n: number, w: number = 2) => n.toString().padStart(w, '0');

  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(millis, 3)}`;
}

/**
 * Convert segments to clean SubRip (.srt) subtitle string
 */
export function generateSrt(segments: TranscriptSegment[]): string {
  if (!segments || segments.length === 0) return '';

  return segments.map((seg, idx) => {
    const startStr = formatSrtTimestamp(seg.start);
    const endStr = formatSrtTimestamp(seg.start + Math.max(seg.duration, 1));
    return `${idx + 1}\n${startStr} --> ${endStr}\n${seg.text.trim()}\n`;
  }).join('\n');
}

/**
 * Convert segments to clean WebVTT (.vtt) subtitle string
 */
export function generateVtt(segments: TranscriptSegment[]): string {
  if (!segments || segments.length === 0) return 'WEBVTT\n\n';

  const body = segments.map((seg, idx) => {
    const startStr = formatVttTimestamp(seg.start);
    const endStr = formatVttTimestamp(seg.start + Math.max(seg.duration, 1));
    return `${idx + 1}\n${startStr} --> ${endStr}\n${seg.text.trim()}\n`;
  }).join('\n');

  return `WEBVTT\n\n${body}`;
}

/**
 * Unescape HTML entities commonly found in video caption tracks
 */
export function unescapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

