import React, { useMemo, useState } from 'react';
import { TranscriptResult } from '../types';
import { formatTimestamp } from '../server/utils/formatters';

interface Props {
  result: TranscriptResult;
  onReset: () => void;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const btn =
  'px-3 py-1.5 text-sm border border-ink bg-surface hover:bg-ink hover:text-paper';

export const TranscriptResultView: React.FC<Props> = ({ result, onReset }) => {
  const [query, setQuery] = useState('');
  const [showTimes, setShowTimes] = useState(true);
  const [copied, setCopied] = useState(false);

  const q = query.trim();

  const visible = useMemo(() => {
    if (!q) return result.segments;
    const lower = q.toLowerCase();
    return result.segments.filter((s) => s.text.toLowerCase().includes(lower));
  }, [result.segments, q]);

  // What "Copy" and "TXT" produce follows the timestamp checkbox, so the
  // file matches what is on screen.
  const plainText = useMemo(
    () =>
      showTimes
        ? result.segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join('\n')
        : result.fullText,
    [result.segments, result.fullText, showTimes]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy failed. Select and copy the text below:', plainText);
    }
  };

  const download = (content: string, ext: string, mime: string) => {
    const base =
      (result.videoTitle || 'transcript')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'transcript';
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const highlight = (text: string): React.ReactNode => {
    if (!q) return text;
    return text
      .split(new RegExp(`(${escapeRegExp(q)})`, 'gi'))
      .map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="bg-[#F2D9A0] text-ink">{part}</mark>
        ) : (
          part
        )
      );
  };

  const words = result.fullText.split(/\s+/).filter(Boolean).length;
  const sourceLabel = result.sourceType === 'captions' ? 'Creator/auto captions' : 'Speech recognition (Whisper)';
  const providerLabel =
    result.provider === 'youtube'
      ? 'YouTube'
      : result.provider === 'tiktok'
      ? 'TikTok'
      : result.provider === 'instagram'
      ? 'Instagram'
      : 'Media file';

  return (
    <section id="transcript-result" className="mt-10 pt-8 border-t border-ink">
      <p className="text-sm text-muted">
        {providerLabel} · {sourceLabel} · language{' '}
        <span className="uppercase">{result.language}</span>
        {result.videoDurationSeconds ? ` · ${formatTimestamp(result.videoDurationSeconds)}` : ''} ·{' '}
        {words.toLocaleString()} words
      </p>
      <h2 className="font-serif text-2xl font-semibold mt-1 leading-snug">
        {result.videoTitle || 'Transcript'}
      </h2>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <button onClick={copy} className={btn}>{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={() => download(plainText, 'txt', 'text/plain')} className={btn}>.txt</button>
        <button onClick={() => download(result.srt, 'srt', 'text/plain')} className={btn}>.srt</button>
        <button onClick={() => download(result.vtt, 'vtt', 'text/vtt')} className={btn}>.vtt</button>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none sm:ml-auto">
          <input
            type="checkbox"
            checked={showTimes}
            onChange={(e) => setShowTimes(e.target.checked)}
            className="accent-accent"
          />
          Timestamps
        </label>
        <button onClick={onReset} className="text-sm underline text-accent hover:text-accent-dark">
          New video
        </button>
      </div>

      <div className="mt-4">
        <label htmlFor="tx-search" className="sr-only">Search transcript</label>
        <input
          id="tx-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search within transcript"
          className="w-full sm:w-80 px-3 py-1.5 text-sm border border-rule bg-surface"
        />
        {q && (
          <span className="ml-3 text-sm text-muted">
            {visible.length} of {result.segments.length} lines
          </span>
        )}
      </div>

      <div className="mt-5 bg-surface border border-rule">
        {visible.length === 0 ? (
          <p className="p-5 text-muted">No lines contain “{q}”.</p>
        ) : (
          <ol className="divide-y divide-rule max-h-[70vh] overflow-y-auto">
            {visible.map((seg) => (
              <li key={seg.id} className="flex gap-4 px-4 py-2.5">
                {showTimes && (
                  <span className="w-14 shrink-0 font-mono text-sm pt-0.5">
                    {result.provider === 'youtube' ? (
                      <a
                        href={`https://www.youtube.com/watch?v=${result.videoId}&t=${Math.floor(seg.start)}s`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open at this moment on YouTube"
                        className="text-accent hover:underline"
                      >
                        {formatTimestamp(seg.start)}
                      </a>
                    ) : (
                      <span className="text-muted">{formatTimestamp(seg.start)}</span>
                    )}
                  </span>
                )}
                <p className="leading-relaxed">{highlight(seg.text)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};
