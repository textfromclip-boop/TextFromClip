import React, { useState } from 'react';
import { TranscriptResult, ApiResponse } from '../types';
import { TranscriptResultView } from './TranscriptResultView';
import { Link, RoutePath } from '../router';
import { validateUrlForPlatform } from '../utils/validation';

export interface PreviewCue {
  time: string;
  text: string;
}

export interface PlatformConfig {
  id: 'youtube' | 'tiktok' | 'instagram';
  route: RoutePath;
  name: string;
  eyebrow: string;
  headingPrefix: string;
  headingHighlight: string;
  intro: string;
  placeholder: string;
  example: {
    label: string;
    shortUrl: string;
    url: string;
    durationLabel: string;
    badgeLabel: string;
    sourceTag: string;
    clipTitle: string;
    cues: PreviewCue[];
  };
  hosts: string[];
  status: { working: boolean; title: string; text: string };
  notes: string[];
}

export const TranscribePage: React.FC<{ config: PlatformConfig }> = ({ config }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptResult | null>(null);

  const run = async (target: string) => {
    const value = target.trim();
    if (!value) {
      setError(`Please enter a ${config.name} video link.`);
      return;
    }

    // Bug 1 & Bug 2: Enforce platform validation before spending network requests
    const validation = validateUrlForPlatform(value, config.id);
    if (!validation.isValid) {
      setError(validation.error || 'Please enter a valid video link.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null); // Clear previous result immediately so stale transcripts never linger

    try {
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: value, platform: config.id }),
      });
      const data: ApiResponse<TranscriptResult> = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(
          (!data.success && data.error?.message) || 'The transcript could not be created.'
        );
      }
      setResult(data.data);
    } catch (e: any) {
      setError(e?.message || 'Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setUrl('');
  };

  return (
    <div className="relative overflow-hidden">
      {/* Subtle Studio Radial Glow matching Logo Gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 w-[44rem] h-[44rem] rounded-full bg-gradient-to-br from-[#0F8CFA]/10 via-[#2868F7]/8 to-[#5131ED]/10 blur-3xl"
      />

      <div className="relative max-w-6xl mx-auto px-5 pt-10 sm:pt-14 pb-6">
        {/* HERO SPLIT LAYOUT (Style 3 Strategic Architecture) */}
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-8 items-center">
          {/* LEFT COLUMN: Action, Input & Platform Switcher */}
          <div className="lg:col-span-7">
            {/* Strategic Eyebrow Pill */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface border border-rule shadow-sm text-xs font-semibold text-ink">
              <span className="w-2 h-2 rounded-full bg-gradient-to-r from-[#0F8CFA] to-[#5131ED]" />
              <span>{config.eyebrow}</span>
            </div>

            {/* Bold Two-Tone Headline Matched to Logo */}
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-[3.35rem] font-black tracking-tight text-ink leading-[1.08]">
              {config.headingPrefix}{' '}
              <span className="bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] bg-clip-text text-transparent">
                {config.headingHighlight}
              </span>
            </h1>

            {/* Strategic Lead Copy */}
            <p className="mt-4 text-base sm:text-lg text-muted max-w-xl leading-relaxed">
              {config.intro}
            </p>

            {/* Unified Pill Input Bar with Integrated Royal-Blue CTA */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(url);
              }}
              className="mt-7 max-w-xl"
            >
              <label htmlFor="video-url" className="sr-only">
                {config.name} video link
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 rounded-2xl bg-surface border border-rule shadow-[0_12px_36px_-8px_rgba(2,19,49,0.09)] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10 transition-all">
                <div className="flex items-center flex-1 gap-3 pl-3 pr-2 py-2 sm:py-1">
                  <svg
                    className="w-5 h-5 text-slate-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                  <input
                    id="video-url"
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                    placeholder={config.placeholder}
                    className="w-full bg-transparent text-ink placeholder:text-slate-400 text-[15px] focus:outline-none disabled:opacity-60"
                    aria-describedby={error ? 'url-error' : undefined}
                    aria-invalid={error ? true : undefined}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] shadow-md hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shrink-0"
                >
                  {loading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-90"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      <span>Transcribing…</span>
                    </>
                  ) : (
                    <>
                      <span>Get Transcript</span>
                      <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </div>

              {/* Visible Validation & Provider Error Alert */}
              {error && (
                <div
                  id="url-error"
                  role="alert"
                  className="mt-3 flex items-start justify-between gap-3 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-sm shadow-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <svg
                      className="w-5 h-5 text-red-600 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
                    </svg>
                    <div className="flex-1">
                      <p className="font-semibold text-red-950">Notice</p>
                      <p className="text-red-800 text-[13.5px] mt-0.5 leading-snug">{error}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-red-400 hover:text-red-700 p-1 rounded-md transition-colors"
                    aria-label="Dismiss error"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Works With Bar + One-Click Live Sample */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2.5 gap-x-4 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-muted">Works with:</span>

                  <Link
                    to="/youtube"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                      config.id === 'youtube'
                        ? 'bg-accent-soft border-accent/30 text-ink'
                        : 'bg-surface border-rule text-muted hover:text-ink'
                    }`}
                  >
                    <span className="w-4 h-4 rounded bg-[#FF0000] text-white inline-flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                    YouTube
                  </Link>

                  <Link
                    to="/tiktok"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                      config.id === 'tiktok'
                        ? 'bg-accent-soft border-accent/30 text-ink'
                        : 'bg-surface border-rule text-muted hover:text-ink'
                    }`}
                  >
                    <span className="w-4 h-4 rounded bg-[#021331] text-white inline-flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                        <path d="M16.6 5.82A4.28 4.28 0 0115.54 3h-3.09v12.4a2.59 2.59 0 01-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 004.3 1.38V7.3s-1.88.09-3.24-1.48z" />
                      </svg>
                    </span>
                    TikTok
                  </Link>

                  <Link
                    to="/instagram"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                      config.id === 'instagram'
                        ? 'bg-accent-soft border-accent/30 text-ink'
                        : 'bg-surface border-rule text-muted hover:text-ink'
                    }`}
                  >
                    <span className="w-4 h-4 rounded bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white inline-flex items-center justify-center">
                      <svg
                        className="w-2.5 h-2.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <rect x="3" y="3" width="18" height="18" rx="5" />
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                    </span>
                    Instagram
                  </Link>

                  <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-muted font-mono text-[11px]">
                    .mp4 / .mp3
                  </span>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setUrl(config.example.url);
                    run(config.example.url);
                  }}
                  className="font-semibold text-accent hover:text-accent-dark underline underline-offset-2 disabled:opacity-50"
                >
                  {config.example.label} →
                </button>
              </div>
            </form>
          </div>

          {/* RIGHT COLUMN: Visual Clip-to-Transcript Flow Showcase (from Style 3) */}
          <div className="lg:col-span-5">
            <div className="relative mx-auto max-w-md lg:max-w-none pt-4 pb-2">
              {/* 1. Floating Source Link Pill + Curved Arrow */}
              <div className="relative z-20 flex items-center gap-2 mb-3 pl-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setUrl(config.example.url);
                    run(config.example.url);
                  }}
                  title="Click to test this live link"
                  className="group inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-surface border border-rule shadow-md hover:border-accent transition-all text-left"
                >
                  <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#0F8CFA] via-[#2868F7] to-[#5131ED] text-white inline-flex items-center justify-center shrink-0">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      />
                    </svg>
                  </span>
                  <span className="font-mono text-xs font-medium text-ink truncate max-w-[210px] group-hover:text-accent">
                    {config.example.shortUrl}
                  </span>
                </button>

                {/* Curved Blue Arrow pointing to Transcript Card */}
                <svg
                  className="w-10 h-8 text-accent shrink-0 translate-y-2"
                  viewBox="0 0 48 36"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 6 C 22 4, 34 12, 38 28"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M32 24 L 38 29 L 42 22"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* 2. Overlapping Video Clip Card + Transcript Card */}
              <div className="relative grid grid-cols-12 items-center">
                {/* Video Clip Preview Card (Left Back) */}
                <div className="col-span-6 sm:col-span-5 z-10 rounded-2xl bg-[#021331] text-white p-3.5 shadow-xl border border-slate-800">
                  <div className="relative rounded-xl bg-gradient-to-br from-[#0F2952] via-[#13386E] to-[#1E1B4B] aspect-[4/3] flex flex-col justify-between p-3 overflow-hidden">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-white/15 backdrop-blur-sm font-semibold">
                        {config.example.badgeLabel}
                      </span>
                      <span className="text-sky-300">{config.example.sourceTag}</span>
                    </div>

                    {/* Center Play Shield + Audio Waveform Bars */}
                    <div className="my-auto flex flex-col items-center gap-2 py-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setUrl(config.example.url);
                          run(config.example.url);
                        }}
                        title="Run sample transcript"
                        className="w-10 h-10 rounded-full bg-gradient-to-r from-[#0F8CFA] to-[#5131ED] text-white flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                      >
                        <svg className="w-4 h-4 fill-current ml-0.5" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                      <div className="flex items-end gap-1 h-4" aria-hidden="true">
                        {[40, 85, 55, 100, 70, 90, 45, 80, 60, 95, 50].map((h, idx) => (
                          <span
                            key={idx}
                            style={{ height: `${h}%` }}
                            className="w-1 rounded-full bg-sky-400/80"
                          />
                        ))}
                      </div>
                    </div>

                    {/* Bottom Player Scrubber */}
                    <div>
                      <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                        <div className="w-2/5 h-full bg-gradient-to-r from-[#0F8CFA] to-[#2868F7]" />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-300">
                        <span>{config.example.durationLabel}</span>
                        <span className="truncate max-w-[90px]">{config.example.clipTitle}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Transcript Card (Right Front) */}
                <div className="col-span-12 sm:col-span-8 sm:-ml-6 mt-3 sm:mt-0 z-20 rounded-2xl bg-surface border border-rule shadow-[0_20px_50px_-12px_rgba(2,19,49,0.16)] p-4 sm:p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-ink">Transcript</span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent-soft text-accent">
                        {config.example.sourceTag}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-muted">
                      TXT · SRT · VTT
                    </span>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {config.example.cues.map((cue, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs leading-relaxed">
                        <span className="font-mono font-semibold text-[11px] text-accent bg-accent-soft px-1.5 py-0.5 rounded shrink-0">
                          {cue.time}
                        </span>
                        <p className="text-ink/90">{cue.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* LIVE TRANSCRIPT RESULT WORKSPACE */}
        {result && <TranscriptResultView result={result} onReset={reset} />}

        {/* STRATEGIC SPECIFICATION STRIP */}
        {!result && (
          <section
            aria-label="Platform details and specifications"
            className="mt-14 pt-10 border-t border-rule grid md:grid-cols-3 gap-5"
          >
            {/* Card 1: Current Platform Status */}
            <div className="rounded-2xl bg-surface border border-rule p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-accent">
                  01 / Platform Status
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Active
                </span>
              </div>
              <h2 className="mt-2.5 text-base font-bold text-ink">{config.status.title}</h2>
              <p className="mt-1.5 text-sm text-muted leading-relaxed">{config.status.text}</p>
            </div>

            {/* Card 2: Supported Links & Guidelines */}
            <div className="rounded-2xl bg-surface border border-rule p-5 shadow-sm">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-accent">
                02 / Supported Links
              </span>
              <h2 className="mt-2.5 text-base font-bold text-ink">
                {config.name} Links
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm text-muted">
                {config.notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-accent font-bold mt-0.5">·</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Card 3: Export Formats */}
            <div className="rounded-2xl bg-surface border border-rule p-5 shadow-sm">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-accent">
                03 / Export Formats
              </span>
              <h2 className="mt-2.5 text-base font-bold text-ink">
                Copy, Search & Subtitles
              </h2>
              <p className="mt-1.5 text-sm text-muted leading-relaxed">
                Copy text with or without <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">[00:12]</code>{' '}
                timestamps, search words instantly, or download <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.txt</code>,{' '}
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.srt</code> and{' '}
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.vtt</code> files for video editors and players.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
