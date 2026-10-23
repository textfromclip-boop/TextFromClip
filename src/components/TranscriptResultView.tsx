import React, { useMemo, useState } from 'react';
import { TranscriptResult } from '../types';
import { formatTimestamp } from '../server/utils/formatters';

interface Props {
  result: TranscriptResult;
  onReset: () => void;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
          <mark key={i} className="bg-blue-100 text-ink px-0.5 rounded">{part}</mark>
        ) : (
          part
        )
      );
  };

  const words = result.fullText.split(/\s+/).filter(Boolean).length;
  const providerLabel =
    result.provider === 'youtube'
      ? 'YouTube'
      : result.provider === 'tiktok'
      ? 'TikTok'
      : result.provider === 'instagram'
      ? 'Instagram Reel'
      : 'Direct Media';

  return (
    <section
      id="transcript-result"
      className="mt-8 rounded-2xl bg-surface border border-rule shadow-[0_16px_44px_-12px_rgba(2,19,49,0.08)] overflow-hidden"
    >
      {/* Top Header Bar */}
      <div className="p-6 sm:p-7 border-b border-rule bg-slate-50/60">
        <p className="text-xs font-bold uppercase tracking-wider text-accent mb-2">
          Your transcript is ready
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-soft text-accent border border-accent/20">
            {providerLabel}
          </span>
          <span className="px-2 py-0.5 rounded bg-white border border-rule uppercase font-mono">
            {result.language}
          </span>
          {result.videoDurationSeconds ? (
            <span>· {formatTimestamp(result.videoDurationSeconds)}</span>
          ) : null}
          <span>· {words.toLocaleString()} words</span>
          <span>· {result.segments.length} segments</span>
        </div>

        <h2 className="text-xl sm:text-2xl font-bold text-ink mt-3 leading-snug">
          {result.videoTitle || 'Transcript'}
        </h2>

        {/* Action Toolbar */}
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            onClick={copy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] text-white shadow-sm hover:opacity-95 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            {copied ? 'Copied to Clipboard!' : 'Copy Transcript'}
          </button>

          <button
            onClick={() => download(plainText, 'txt', 'text/plain')}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-rule bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
          >
            Download .TXT
          </button>
          <button
            onClick={() => download(result.srt, 'srt', 'text/plain')}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-rule bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
          >
            Download .SRT
          </button>
          <button
            onClick={() => download(result.vtt, 'vtt', 'text/vtt')}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-rule bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
          >
            Download .VTT
          </button>

          <div className="flex items-center gap-4 sm:ml-auto pt-1 sm:pt-0">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTimes}
                onChange={(e) => setShowTimes(e.target.checked)}
                className="w-4 h-4 rounded accent-accent"
              />
              Timestamps
            </label>
            <button
              onClick={onReset}
              className="text-sm font-semibold text-accent hover:text-accent-dark transition-colors"
            >
              Transcribe another →
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-80">
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              id="tx-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search words in transcript…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-rule bg-surface text-ink placeholder:text-slate-400 focus:outline-none focus:border-accent"
            />
          </div>
          {q && (
            <span className="text-xs font-semibold text-muted">
              Showing {visible.length} of {result.segments.length} segments
            </span>
          )}
        </div>
      </div>

      {/* Transcript Segment List */}
      <div className="bg-surface">
        {visible.length === 0 ? (
          <p className="p-8 text-center text-muted">No transcript lines match “{q}”.</p>
        ) : (
          <ol className="divide-y divide-slate-100 max-h-[68vh] overflow-y-auto">
            {visible.map((seg) => (
              <li
                key={seg.id}
                className="flex items-start gap-4 px-6 py-3.5 hover:bg-slate-50/80 transition-colors"
              >
                {showTimes && (
                  <span className="shrink-0 pt-0.5">
                    {result.provider === 'youtube' ? (
                      <a
                        href={`https://www.youtube.com/watch?v=${result.videoId}&t=${Math.floor(seg.start)}s`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open at this moment on YouTube"
                        className="inline-block font-mono text-xs font-semibold px-2 py-1 rounded-md bg-accent-soft text-accent hover:bg-accent hover:text-white transition-colors"
                      >
                        {formatTimestamp(seg.start)}
                      </a>
                    ) : (
                      <span className="inline-block font-mono text-xs font-semibold px-2 py-1 rounded-md bg-accent-soft text-accent">
                        {formatTimestamp(seg.start)}
                      </span>
                    )}
                  </span>
                )}
                <p className="text-[15px] text-ink leading-relaxed">{highlight(seg.text)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};
