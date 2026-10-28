import React, { useEffect, useRef, useState } from 'react';
import { TranscriptResult, ApiResponse } from '../types';
import { TranscriptResultView } from './TranscriptResultView';
import { Link, RoutePath } from '../router';
import { validateUrlForPlatform } from '../utils/validation';
import {
  uploadAndTranscribeMediaFile,
  UploadProgressUpdate,
  validateSelectedMediaFile,
} from '../utils/audioExtractor';

const HISTORY_STORAGE_KEY = 'textfromclip_history_v1';

interface HistoryEntry {
  sourceUrl: string;
  data: TranscriptResult;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, 10)));
  } catch {
    // Ignore storage quota errors
  }
}

export interface PreviewCue {
  time: string;
  text: string;
}

export interface PlatformConfig {
  id: 'youtube' | 'tiktok' | 'instagram' | 'upload';
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
  const [uploadProgress, setUploadProgress] = useState<UploadProgressUpdate | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const [urlProgress, setUrlProgress] = useState<UploadProgressUpdate | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const resultSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFileLoading = loading && Boolean(uploadProgress);
  const isUrlLoading = loading && !uploadProgress;

  // Smooth step progression while a video URL is being transcribed
  useEffect(() => {
    if (!isUrlLoading) {
      setUrlProgress(null);
      return;
    }

    setUrlProgress({
      stage: 'Checking your video link…',
      detail: 'Connecting to video',
      percent: 28,
      step: 1,
      totalSteps: 3,
    });

    const t1 = window.setTimeout(() => {
      setUrlProgress({
        stage: 'Listening to the audio…',
        detail: 'Reading spoken words from the clip',
        percent: 62,
        step: 2,
        totalSteps: 3,
      });
    }, 1600);

    const t2 = window.setTimeout(() => {
      setUrlProgress({
        stage: 'Writing your transcript…',
        detail: 'Adding timestamps and preparing text',
        percent: 88,
        step: 3,
        totalSteps: 3,
      });
    }, 3800);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isUrlLoading]);

  // Smoothly advance percentage during the final speech-to-text step on file uploads
  useEffect(() => {
    if (!isFileLoading || !uploadProgress || uploadProgress.step !== 4) return;
    const interval = window.setInterval(() => {
      setUploadProgress((prev) => {
        if (!prev || prev.step !== 4 || prev.percent >= 95) return prev;
        return {
          ...prev,
          percent: Math.min(95, prev.percent + 2),
          detail:
            prev.percent >= 90
              ? 'Almost done — finishing up your transcript'
              : prev.detail,
        };
      });
    }, 900);
    return () => window.clearInterval(interval);
  }, [isFileLoading, uploadProgress?.step]);

  const scrollToTranscript = () => {
    window.setTimeout(() => {
      resultSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 90);
  };

  useEffect(() => {
    setHistory(loadHistory());
  }, [config.id]);

  useEffect(() => {
    if (!result) return;
    scrollToTranscript();
  }, [result?.id, result?.videoId]);

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

    // Check local cache first so re-running a link loads in 0ms and costs 0 credits
    const cached = history.find(
      (entry) =>
        entry.data.provider === config.id &&
        entry.sourceUrl.trim().toLowerCase() === value.toLowerCase()
    );
    if (cached) {
      setError(null);
      setResult(cached.data);
      scrollToTranscript();
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
      setHistory((prev) => {
        const filtered = prev.filter(
          (item) =>
            !(item.data.provider === data.data.provider && item.data.videoId === data.data.videoId)
        );
        const updated = [{ sourceUrl: value, data: data.data }, ...filtered].slice(0, 10);
        saveHistory(updated);
        return updated;
      });
    } catch (e: any) {
      setError(e?.message || 'Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File | null | undefined) => {
    if (!file || loading) return;

    const validation = validateSelectedMediaFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Please choose a supported audio or video file.');
      return;
    }

    setLoading(true);
    setUploadingFileName(file.name);
    setUploadProgress({
      stage: 'Reading your file…',
      detail: 'Checking video and audio track',
      percent: 12,
      step: 1,
      totalSteps: 4,
    });
    setError(null);
    setResult(null);

    try {
      const data = await uploadAndTranscribeMediaFile(file, {
        onProgress: (stage, update) => {
          if (update) {
            setUploadProgress(update);
          } else {
            setUploadProgress((prev) => ({
              stage,
              detail: prev?.detail || 'Processing your file',
              percent: prev?.percent || 50,
              step: prev?.step || 2,
              totalSteps: 4,
            }));
          }
        },
      });
      setResult(data);
      setHistory((prev) => {
        const filtered = prev.filter(
          (item) =>
            !(item.data.provider === data.provider && item.data.videoId === data.videoId)
        );
        const updated = [{ sourceUrl: file.name, data }, ...filtered].slice(0, 10);
        saveHistory(updated);
        return updated;
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to upload and transcribe the selected file.');
    } finally {
      setLoading(false);
      setUploadProgress(null);
      setUploadingFileName(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUpdateResult = (updated: TranscriptResult) => {
    setResult(updated);
    setHistory((prev) => {
      const next = prev.map((item) =>
        item.data.provider === updated.provider && item.data.videoId === updated.videoId
          ? { ...item, data: updated }
          : item
      );
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setUrl('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="relative overflow-hidden">
      {/* Subtle Studio Radial Glow matching Logo Gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 w-[44rem] h-[44rem] rounded-full bg-gradient-to-br from-[#0F8CFA]/10 via-[#2868F7]/8 to-[#5131ED]/10 blur-3xl"
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-5 pt-6 sm:pt-14 pb-6">
        {/* HERO SPLIT LAYOUT (Style 3 Strategic Architecture) */}
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-8 items-center">
          {/* LEFT COLUMN: Action, Input & Platform Switcher */}
          <div className="lg:col-span-7 min-w-0">
            {/* Strategic Eyebrow Pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full bg-surface border border-rule shadow-sm text-xs font-semibold text-ink">
              <span className="w-2 h-2 rounded-full bg-gradient-to-r from-[#0F8CFA] to-[#5131ED]" />
              <span>{config.eyebrow}</span>
            </div>

            {/* Bold Two-Tone Headline Matched to Logo */}
            <h1 className="mt-4 sm:mt-5 text-3xl sm:text-5xl lg:text-[3.35rem] font-black tracking-tight text-ink leading-[1.1]">
              {config.headingPrefix}{' '}
              <span className="bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] bg-clip-text text-transparent">
                {config.headingHighlight}
              </span>
            </h1>

            {/* Strategic Lead Copy */}
            <p className="mt-3 sm:mt-4 text-[15px] sm:text-lg text-muted max-w-xl leading-relaxed">
              {config.intro}
            </p>

            {/* Unified Pill Input Bar + File Upload Dropzone */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.ogg,.aac,.flac"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
              className="sr-only"
              aria-label="Upload audio or video file"
            />

            {config.id === 'upload' && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!loading) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (!loading && e.dataTransfer.files?.[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => {
                  if (!loading) fileInputRef.current?.click();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !loading) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`mt-7 max-w-xl rounded-2xl border-2 border-dashed p-6 sm:p-7 text-center transition-all shadow-[0_12px_36px_-8px_rgba(2,19,49,0.07)] ${
                  isDragging
                    ? 'border-accent bg-accent-soft/60 scale-[1.01]'
                    : 'border-accent/40 bg-surface hover:border-accent hover:bg-accent-soft/20'
                } ${loading ? 'cursor-wait' : 'cursor-pointer'}`}
              >
                <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] text-white flex items-center justify-center shadow-md">
                  {isFileLoading ? (
                    <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none">
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
                  ) : (
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                  )}
                </div>

                {isFileLoading && uploadProgress ? (
                  <div className="mt-4 max-w-md mx-auto text-left">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="text-ink font-bold text-sm">{uploadProgress.stage}</span>
                      <span className="font-mono text-accent bg-accent-soft px-2 py-0.5 rounded-full">
                        Step {uploadProgress.step} of {uploadProgress.totalSteps} · {uploadProgress.percent}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted truncate">
                      {uploadingFileName ? `${uploadingFileName} — ` : ''}
                      {uploadProgress.detail}
                    </p>
                    <div className="mt-3 h-2.5 w-full rounded-full bg-slate-200/90 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] transition-all duration-500 ease-out"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-3.5 text-base font-bold text-ink">
                      Drop an audio or video file here, or click to browse
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
                      {['MP4', 'MP3', 'WAV', 'MOV', 'M4A', 'WEBM'].map((fmt) => (
                        <span
                          key={fmt}
                          className="px-2 py-0.5 rounded bg-slate-100 border border-rule font-mono text-[10px] font-bold text-ink"
                        >
                          {fmt}
                        </span>
                      ))}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Up to 200 MB
                      </span>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] shadow-md">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                        />
                      </svg>
                      <span>Choose Audio / Video File</span>
                    </span>
                  </>
                )}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(url);
              }}
              className={config.id === 'upload' ? 'mt-4 max-w-xl' : 'mt-7 max-w-xl'}
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
                    className="w-full min-w-0 bg-transparent text-ink placeholder:text-slate-400 text-base sm:text-[15px] focus:outline-none disabled:opacity-60"
                    aria-describedby={error ? 'url-error' : undefined}
                    aria-invalid={error ? true : undefined}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] shadow-md hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shrink-0"
                >
                  {isUrlLoading ? (
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
                      <span>Working…</span>
                    </>
                  ) : (
                    <>
                      <span>Get Transcript</span>
                      <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </div>

              {/* Live Progress Bar when transcribing a video URL */}
              {isUrlLoading && urlProgress && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-3 p-3.5 rounded-2xl bg-surface border border-accent/30 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-ink text-sm">{urlProgress.stage}</span>
                    <span className="font-mono font-semibold text-accent bg-accent-soft px-2 py-0.5 rounded-full">
                      Step {urlProgress.step} of {urlProgress.totalSteps} · {urlProgress.percent}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{urlProgress.detail}</p>
                  <div className="mt-2.5 h-2 w-full rounded-full bg-slate-200/90 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] transition-all duration-500 ease-out"
                      style={{ width: `${urlProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {config.id !== 'upload' && (
                <div className="mt-3.5">
                  {/* Clear "OR" separator so users immediately see File Upload as a primary option */}
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="h-px flex-1 bg-rule" />
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted">
                      or upload from your device
                    </span>
                    <div className="h-px flex-1 bg-rule" />
                  </div>

                  {/* Tactile, Unmistakable File Upload Dropzone Card with Built-In Progress Bar */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!loading) setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (!loading && e.dataTransfer.files?.[0]) {
                        handleFileUpload(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => {
                      if (!loading) fileInputRef.current?.click();
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !loading) {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`group relative flex flex-col justify-between gap-3 p-3.5 sm:px-4 sm:py-3.5 rounded-2xl border-2 border-dashed transition-all ${
                      isDragging
                        ? 'border-accent bg-accent-soft/70 scale-[1.01] shadow-md'
                        : 'border-[#0F8CFA]/45 bg-gradient-to-r from-[#0F8CFA]/[0.05] via-[#2868F7]/[0.04] to-[#5131ED]/[0.06] hover:border-accent hover:from-[#0F8CFA]/[0.09] hover:to-[#5131ED]/[0.10] shadow-sm hover:shadow-md'
                    } ${loading ? 'cursor-wait' : 'cursor-pointer'}`}
                  >
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5 w-full">
                      <div className="flex items-center gap-3.5 min-w-0 w-full sm:w-auto">
                        {/* Gradient Cloud/File Upload Icon */}
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0F8CFA] via-[#2868F7] to-[#5131ED] text-white flex items-center justify-center shadow-md shrink-0 group-hover:scale-105 transition-transform">
                          {isFileLoading ? (
                            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
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
                          ) : (
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2.2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                              />
                            </svg>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 text-left">
                          {isFileLoading && uploadProgress ? (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-ink">
                                  {uploadProgress.stage}
                                </span>
                                <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-accent-soft text-accent border border-accent/20">
                                  Step {uploadProgress.step} of {uploadProgress.totalSteps} ·{' '}
                                  {uploadProgress.percent}%
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-muted truncate">
                                {uploadingFileName ? `${uploadingFileName} — ` : ''}
                                {uploadProgress.detail}
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-ink group-hover:text-accent transition-colors">
                                  Upload Video or Audio File
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  Up to 200 MB
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                                <span>Drag & drop or browse</span>
                                <span className="text-slate-300">·</span>
                                {['MP4', 'MP3', 'WAV', 'MOV', 'M4A'].map((fmt) => (
                                  <span
                                    key={fmt}
                                    className="px-1.5 py-0.5 rounded bg-white/90 border border-rule font-mono text-[10px] font-semibold text-ink"
                                  >
                                    {fmt}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {!isFileLoading && (
                        <span className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-[#021331] group-hover:bg-gradient-to-r group-hover:from-[#0F8CFA] group-hover:via-[#2868F7] group-hover:to-[#5131ED] shadow-sm transition-all shrink-0">
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                            />
                          </svg>
                          <span>Choose File</span>
                        </span>
                      )}
                    </div>

                    {/* Visual Progress Bar inside the Upload Card */}
                    {isFileLoading && uploadProgress && (
                      <div className="w-full pt-1">
                        <div className="h-2.5 w-full rounded-full bg-slate-200/90 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] transition-all duration-500 ease-out"
                            style={{ width: `${uploadProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

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

                  <Link
                    to="/upload"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                      config.id === 'upload'
                        ? 'bg-accent-soft border-accent/30 text-ink'
                        : 'bg-surface border-rule text-muted hover:text-ink'
                    }`}
                  >
                    <span className="w-4 h-4 rounded bg-emerald-600 text-white inline-flex items-center justify-center">
                      <svg
                        className="w-2.5 h-2.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12L8 8m4-4l4 4"
                        />
                      </svg>
                    </span>
                    Local Files
                  </Link>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    if (config.id === 'upload' || !config.example.url) {
                      fileInputRef.current?.click();
                    } else {
                      setUrl(config.example.url);
                      run(config.example.url);
                    }
                  }}
                  className="font-semibold text-accent hover:text-accent-dark underline underline-offset-2 disabled:opacity-50"
                >
                  {config.example.label} →
                </button>
              </div>
            </form>
          </div>

          {/* RIGHT COLUMN: Visual Clip-to-Transcript Flow Showcase (from Style 3) */}
          <div className="lg:col-span-5 min-w-0">
            <div className="relative mx-auto max-w-md lg:max-w-none pt-2 sm:pt-4 pb-2">
              {/* 1. Floating Source Link Pill + Curved Arrow */}
              <div className="relative z-20 flex items-center gap-2 mb-3 pl-1 sm:pl-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    if (config.id === 'upload' || !config.example.url) {
                      fileInputRef.current?.click();
                    } else {
                      setUrl(config.example.url);
                      run(config.example.url);
                    }
                  }}
                  title={config.id === 'upload' ? 'Click to upload a file' : 'Click to test this live link'}
                  className="group inline-flex items-center gap-2.5 px-3 py-2 sm:px-3.5 rounded-xl bg-surface border border-rule shadow-md hover:border-accent transition-all text-left min-w-0 max-w-full"
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
                  <span className="font-mono text-xs font-medium text-ink truncate max-w-[180px] sm:max-w-[210px] group-hover:text-accent">
                    {config.example.shortUrl}
                  </span>
                </button>

                {/* Curved Blue Arrow pointing to Transcript Card */}
                <svg
                  className="w-9 h-7 sm:w-10 sm:h-8 text-accent shrink-0 translate-y-2"
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
                {/* Video Clip Preview Card (Full width on mobile, Left Back on sm+) */}
                <div className="col-span-12 sm:col-span-5 z-10 rounded-2xl bg-[#021331] text-white p-3.5 shadow-xl border border-slate-800">
                  <div className="relative rounded-xl bg-gradient-to-br from-[#0F2952] via-[#13386E] to-[#1E1B4B] aspect-[16/9] sm:aspect-[4/3] flex flex-col justify-between p-3 overflow-hidden">
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
                          if (config.id === 'upload' || !config.example.url) {
                            fileInputRef.current?.click();
                          } else {
                            setUrl(config.example.url);
                            run(config.example.url);
                          }
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
        {result && (
          <div
            ref={resultSectionRef}
            className="scroll-mt-24 animate-transcript-reveal"
          >
            <TranscriptResultView
              result={result}
              onReset={reset}
              onUpdateResult={handleUpdateResult}
            />
          </div>
        )}

        {/* RECENT TRANSCRIPTS SHELF (INSTANT 0ms LOCAL CACHE) */}
        {!result &&
          history.filter(
            (h) =>
              h.data.provider === config.id ||
              (config.id === 'upload' &&
                (h.data.provider === 'file_upload' || h.data.provider === 'direct_media'))
          ).length > 0 && (
          <section
            aria-label="Recent transcripts"
            className="mt-10 pt-8 border-t border-rule"
          >
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent" />
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-ink">
                  Recent {config.name} Transcripts
                </h2>
                <span className="text-[11px] font-medium text-muted">
                  (Instant reload · 0 wait)
                </span>
              </div>
              <button
                type="button"
                onClick={clearHistory}
                className="text-xs font-semibold text-muted hover:text-ink transition-colors"
              >
                Clear history
              </button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {history
                .filter(
                  (h) =>
                    h.data.provider === config.id ||
                    (config.id === 'upload' &&
                      (h.data.provider === 'file_upload' || h.data.provider === 'direct_media'))
                )
                .slice(0, 6)
                .map((item, idx) => (
                  <button
                    key={`${item.data.provider}-${item.data.videoId}-${idx}`}
                    type="button"
                    onClick={() => {
                      setUrl(item.sourceUrl);
                      setError(null);
                      setResult(item.data);
                    }}
                    className="group flex items-center gap-3 p-3 rounded-xl bg-surface border border-rule hover:border-accent/50 hover:shadow-md transition-all text-left"
                  >
                    {item.data.videoThumbnailUrl ? (
                      <img
                        src={item.data.videoThumbnailUrl}
                        alt={item.data.videoTitle || 'Video thumbnail'}
                        className="w-12 h-12 rounded-lg object-cover shrink-0 bg-slate-100 border border-rule"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-accent-soft text-accent flex items-center justify-center font-bold text-xs shrink-0">
                        TXT
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink truncate group-hover:text-accent transition-colors">
                        {item.data.videoTitle || 'Untitled video'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted truncate">
                        {item.data.segments.length} segments ·{' '}
                        {item.data.fullText.trim().split(/\s+/).filter(Boolean).length} words
                      </p>
                    </div>
                  </button>
                ))}
            </div>
          </section>
        )}

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
