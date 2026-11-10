import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BILINGUAL_LANGUAGES,
  Flashcard,
  RevisionPack,
  TranscriptResult,
  TranscriptSegment,
} from '../types';
import { formatTimestamp, generateSrt, generateVtt } from '../server/utils/formatters';
import { apiFetch, clearPendingReferral, getPendingReferral } from '../utils/apiClient';
import { navigate } from '../router';
import { buildTranscriptScopeKey, createScopedResultCache, fnv1aHash } from '../utils/transformCache';
import {
  ContentTabKind,
  FormattedContent,
  parseTimestampedTranscript,
  resolveTranslationSource,
} from './FormattedContent';
import { RevisionPackView } from './RevisionPackView';
import { trackEvent } from '../utils/analytics';

interface Props {
  result: TranscriptResult;
  sourceUrl?: string;
  /** Preselected second language for bilingual cards (e.g. on /flashcards-in-arabic). */
  defaultSecondLanguage?: string;
  onReset: () => void;
  onUpdateResult?: (updated: TranscriptResult) => void;
  onRevisionPackCreated?: (pack: RevisionPack, sourceUrl?: string) => void;
  onCardReviewed?: (packId: string, card: Flashcard, rating: 'again' | 'hard' | 'good' | 'easy') => void;
  onBuildMissedDeck?: (packTitle: string, missedCards: Flashcard[]) => void;
  onOpenFullStudyPage?: () => void;
}

type ActiveTab = 'original' | 'transform' | 'translate';

interface TransformOption {
  id: 'summary' | 'script' | 'blog' | 'thread' | 'notes';
  label: string;
  desc: string;
}

const TRANSFORM_OPTIONS: TransformOption[] = [
  { id: 'summary', label: 'Executive Summary', desc: 'Key takeaways & bullet points' },
  { id: 'script', label: 'Viral Video Script', desc: 'Hook + body + CTA for Reels/TikTok' },
  { id: 'blog', label: 'Blog Post / Article', desc: 'Structured article with headings' },
  { id: 'thread', label: 'X / LinkedIn Thread', desc: 'Ready-to-post 6-part thread' },
  { id: 'notes', label: 'Study Notes & Quotes', desc: 'Concepts, verbatim quotes & Q&A' },
];

const TRANSLATE_LANGUAGES = [
  'Arabic',
  'Spanish',
  'French',
  'German',
  'Turkish',
  'Portuguese',
  'Hindi',
  'Chinese (Simplified)',
  'Japanese',
  'Russian',
  'Italian',
  'English',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const TranscriptResultView: React.FC<Props> = ({
  result,
  sourceUrl,
  defaultSecondLanguage,
  onReset,
  onUpdateResult,
  onRevisionPackCreated,
  onCardReviewed,
  onBuildMissedDeck,
  onOpenFullStudyPage,
}) => {
  const [segments, setSegments] = useState<TranscriptSegment[]>(result.segments);
  const [hasEdits, setHasEdits] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [query, setQuery] = useState('');
  const [showTimes, setShowTimes] = useState(true);
  const [copied, setCopied] = useState(false);

  // Revision Pack state (Core LearnFromClip flow)
  const [revisionPack, setRevisionPack] = useState<RevisionPack | null>(null);
  const [packSecondLang, setPackSecondLang] = useState<string>(defaultSecondLanguage || '');
  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  const [packProgress, setPackProgress] = useState<{
    stage: string;
    detail: string;
    percent: number;
    step: number;
    totalSteps: number;
  } | null>(null);

  // Active tab & AI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('original');
  const [lastContentTab, setLastContentTab] = useState<ContentTabKind>('original');
  const [transformMenuOpen, setTransformMenuOpen] = useState(false);
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState<{
    stage: string;
    detail: string;
    percent: number;
    step: number;
    totalSteps: number;
  } | null>(null);

  const [transformedText, setTransformedText] = useState<string | null>(null);
  const [transformLabel, setTransformLabel] = useState<string>('AI Summary');

  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translatedLang, setTranslatedLang] = useState<string>('');
  const [translatedSourceKind, setTranslatedSourceKind] = useState<ContentTabKind>('original');
  const [translatedSourceLabel, setTranslatedSourceLabel] = useState<string>('Transcript');

  const toolbarRef = useRef<HTMLDivElement>(null);
  const packSectionRef = useRef<HTMLDivElement>(null);
  const aiCacheRef = useRef(createScopedResultCache(30));

  // Sync segments when a new result arrives
  useEffect(() => {
    setSegments(result.segments);
    setHasEdits(false);
    setIsEditing(false);
    setActiveTab('original');
    setLastContentTab('original');
    setTransformedText(null);
    setTranslatedText(null);
    setAiError(null);
    setRevisionPack(null);
    setPackError(null);
  }, [result.id, result.videoId, result.provider]);

  // Progress steps for "Make my revision pack"
  useEffect(() => {
    if (!packLoading) {
      setPackProgress(null);
      return;
    }

    setPackProgress({
      stage: 'Structuring lecture notes & definitions…',
      detail: 'Grouping sections and linking every bullet to its lecture timestamp',
      percent: 28,
      step: 1,
      totalSteps: 3,
    });

    const t1 = window.setTimeout(() => {
      setPackProgress({
        stage: 'Building active-recall flashcards…',
        detail: packSecondLang
          ? `Creating bilingual question/answer cards (+ ${packSecondLang})`
          : 'Creating question/answer cards with verbatim lecture quotes',
        percent: 64,
        step: 2,
        totalSteps: 3,
      });
    }, 1500);

    const t2 = window.setTimeout(() => {
      setPackProgress({
        stage: 'Generating 10-question quiz & verifying quotes…',
        detail: 'Checking every quote word-for-word against the transcript',
        percent: 90,
        step: 3,
        totalSteps: 3,
      });
    }, 3400);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [packLoading, packSecondLang]);

  // Close dropdown menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setTransformMenuOpen(false);
        setTranslateMenuOpen(false);
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // User-friendly progress bar stages during AI Summary/Rewrite and Translation
  useEffect(() => {
    if (!aiLoading || activeTab === 'original') {
      setAiProgress(null);
      return;
    }

    const isTransform = activeTab === 'transform';
    setAiProgress({
      stage: isTransform
        ? 'Reading your transcript…'
        : `Reading ${translatedSourceLabel.toLowerCase()}…`,
      detail: isTransform
        ? 'Finding the main points and key ideas'
        : 'Keeping your timestamps and layout intact',
      percent: 30,
      step: 1,
      totalSteps: 3,
    });

    const t1 = window.setTimeout(() => {
      setAiProgress({
        stage: isTransform
          ? `Writing your ${transformLabel}…`
          : `Translating into ${translatedLang}…`,
        detail: isTransform
          ? 'Organizing sections clearly based on what was said'
          : `Writing natural, fluent ${translatedLang}`,
        percent: 68,
        step: 2,
        totalSteps: 3,
      });
    }, 1800);

    const t2 = window.setTimeout(() => {
      setAiProgress({
        stage: isTransform
          ? 'Polishing your final text…'
          : 'Checking timestamps and formatting…',
        detail: 'Almost ready',
        percent: 90,
        step: 3,
        totalSteps: 3,
      });
    }, 4000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [aiLoading, activeTab, transformLabel, translatedLang, translatedSourceLabel]);

  const q = query.trim();

  const fullText = useMemo(
    () => segments.map((s) => s.text.trim()).filter(Boolean).join(' '),
    [segments]
  );

  const scopeKey = useMemo(
    () => buildTranscriptScopeKey(result.provider, result.videoId, fullText),
    [result.provider, result.videoId, fullText]
  );
  const latestScopeRef = useRef(scopeKey);
  latestScopeRef.current = scopeKey;

  const srtContent = useMemo(
    () => (hasEdits ? generateSrt(segments) : result.srt),
    [segments, hasEdits, result.srt]
  );

  const vttContent = useMemo(
    () => (hasEdits ? generateVtt(segments) : result.vtt),
    [segments, hasEdits, result.vtt]
  );

  const visible = useMemo(() => {
    if (!q) return segments;
    const lower = q.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(lower));
  }, [segments, q]);

  // Group segments into natural ~5-segment paragraphs when Timestamps are toggled off
  const paragraphs = useMemo(() => {
    const bucketSize = 5;
    const groups: { id: number; start: number; text: string }[] = [];
    for (let i = 0; i < visible.length; i += bucketSize) {
      const slice = visible.slice(i, i + bucketSize);
      if (slice.length > 0) {
        groups.push({
          id: slice[0].id,
          start: slice[0].start,
          text: slice.map((s) => s.text.trim()).join(' '),
        });
      }
    }
    return groups;
  }, [visible]);

  const activeCopyText = useMemo(() => {
    if (activeTab === 'transform' && transformedText) return transformedText;
    if (activeTab === 'translate' && translatedText) return translatedText;
    return showTimes
      ? segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join('\n')
      : paragraphs.map((p) => p.text).join('\n\n');
  }, [activeTab, transformedText, translatedText, showTimes, segments, paragraphs]);

  const parsedTranslatedTimestamps = useMemo(
    () =>
      translatedText && translatedSourceKind === 'original'
        ? parseTimestampedTranscript(translatedText)
        : null,
    [translatedText, translatedSourceKind]
  );

  const handleSegmentChange = (id: number, newText: string) => {
    const next = segments.map((s) => (s.id === id ? { ...s, text: newText } : s));
    setSegments(next);
    setHasEdits(true);
    setLastContentTab('original');
    setTransformedText(null);
    setTranslatedText(null);
    if (onUpdateResult) {
      onUpdateResult({
        ...result,
        segments: next,
        fullText: next.map((s) => s.text.trim()).filter(Boolean).join(' '),
        srt: generateSrt(next),
        vtt: generateVtt(next),
      });
    }
  };

  const resetEdits = () => {
    setSegments(result.segments);
    setHasEdits(false);
    setLastContentTab('original');
    setTransformedText(null);
    setTranslatedText(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(activeCopyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy failed. Select and copy the text below:', activeCopyText);
    }
  };

  const download = (content: string, ext: string, mime: string, suffix: string = '') => {
    trackEvent('export_clicked');
    const base =
      (result.videoTitle || 'transcript')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'transcript';
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloadMenuOpen(false);
  };

  const makeRevisionPack = async (overrideSecondLang?: string) => {
    const chosenLang =
      overrideSecondLang !== undefined ? overrideSecondLang : packSecondLang;
    if (overrideSecondLang !== undefined) {
      setPackSecondLang(overrideSecondLang);
    }

    trackEvent('pack_started');
    setPackLoading(true);
    setPackError(null);
    const reqScope = scopeKey;

    try {
      const pendingReferral = getPendingReferral();
      const res = await apiFetch('/api/revision-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: result.videoId,
          provider: result.provider,
          videoTitle: result.videoTitle || 'Lecture',
          durationSeconds: result.videoDurationSeconds,
          segments,
          secondLanguage: chosenLang || undefined,
          referralCode: pendingReferral,
        }),
      });
      if (res.status === 429) {
        trackEvent('limit_hit');
      }
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // non-JSON response
      }
      if (!res.ok || !json?.success || !json?.data) {
        throw new Error(
          json?.error?.message ||
          (res.status === 429 ? 'Daily limit reached. Please wait or upgrade.' : 'Could not generate revision pack right now.')
        );
      }

      if (latestScopeRef.current !== reqScope) return;

      if (pendingReferral && json.referral) clearPendingReferral();
      const generatedPack: RevisionPack = json.data;
      trackEvent('pack_done');
      setRevisionPack(generatedPack);
      onRevisionPackCreated?.(generatedPack, sourceUrl);

      window.setTimeout(() => {
        packSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err: any) {
      if (latestScopeRef.current === reqScope) {
        setPackError(
          err?.message || 'Could not generate your revision pack right now.'
        );
      }
    } finally {
      if (latestScopeRef.current === reqScope) {
        setPackLoading(false);
      }
    }
  };

  const runTransform = async (opt: TransformOption) => {
    setTransformMenuOpen(false);
    setAiError(null);
    setTransformLabel(opt.label);
    setActiveTab('transform');
    setLastContentTab('transform');

    const reqScope = scopeKey;
    const cached = aiCacheRef.current.get(reqScope, 'transform', opt.id);
    if (cached) {
      setTransformedText(cached);
      setAiLoading(false);
      return;
    }

    setTransformedText(null);
    setAiLoading(true);

    try {
      const res = await apiFetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: fullText,
          segments,
          videoTitle: result.videoTitle,
          mode: opt.id,
        }),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // non-JSON response
      }
      const outputText = typeof json?.data?.result === 'string' ? json.data.result.trim() : '';
      if (!res.ok || !json?.success || !outputText) {
        throw new Error(json?.error?.message || 'Failed to generate AI transformation.');
      }

      if (latestScopeRef.current !== reqScope) {
        return;
      }

      aiCacheRef.current.set(reqScope, 'transform', opt.id, outputText);
      setTransformedText(outputText);
    } catch (err: any) {
      if (latestScopeRef.current === reqScope) {
        setTransformedText(null);
        setAiError(err?.message || 'Could not transform transcript right now.');
      }
    } finally {
      if (latestScopeRef.current === reqScope) {
        setAiLoading(false);
      }
    }
  };

  const runTranslate = async (lang: string) => {
    const resolved = resolveTranslationSource({
      activeTab,
      lastContentTab,
      transformedText,
      transformLabel,
      showTimes,
      segments,
      paragraphs,
    });

    setTranslateMenuOpen(false);
    setAiError(null);
    setTranslatedLang(lang);
    setTranslatedSourceKind(resolved.sourceKind);
    setTranslatedSourceLabel(resolved.sourceLabel);
    setActiveTab('translate');

    const reqScope = scopeKey;
    const cacheSubKey = `${resolved.sourceKind}:${showTimes ? 'timed' : 'plain'}:${fnv1aHash(resolved.sourceText)}:${lang}`;
    const cached = aiCacheRef.current.get(reqScope, 'translate', cacheSubKey);
    if (cached) {
      setTranslatedText(cached);
      setAiLoading(false);
      return;
    }

    setTranslatedText(null);
    setAiLoading(true);

    try {
      const res = await apiFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: resolved.sourceText,
          targetLanguage: lang,
        }),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // non-JSON response
      }
      const outputText =
        typeof json?.data?.translatedText === 'string' ? json.data.translatedText.trim() : '';
      if (!res.ok || !json?.success || !outputText) {
        throw new Error(json?.error?.message || 'Failed to translate content.');
      }

      if (latestScopeRef.current !== reqScope) {
        return;
      }

      aiCacheRef.current.set(reqScope, 'translate', cacheSubKey, outputText);
      setTranslatedText(outputText);
    } catch (err: any) {
      if (latestScopeRef.current === reqScope) {
        setTranslatedText(null);
        setAiError(err?.message || 'Could not translate content right now.');
      }
    } finally {
      if (latestScopeRef.current === reqScope) {
        setAiLoading(false);
      }
    }
  };

  const highlight = (text: string): React.ReactNode => {
    if (!q) return text;
    return text
      .split(new RegExp(`(${escapeRegExp(q)})`, 'gi'))
      .map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="bg-blue-100 text-ink px-0.5 rounded">
            {part}
          </mark>
        ) : (
          part
        )
      );
  };

  const words = fullText.split(/\s+/).filter(Boolean).length;
  const providerLabel =
    result.provider === 'youtube'
      ? 'YouTube'
      : result.provider === 'tiktok'
      ? 'TikTok'
      : result.provider === 'instagram'
      ? 'Instagram Reel'
      : result.provider === 'file_upload'
      ? 'Uploaded File'
      : 'Direct Media';

  return (
    <div className="mt-8 space-y-6">
      {/* Revision pack generator: a plain, light action bar */}
      <div className="rounded-lg border border-rule bg-surface p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <h3 className="font-serif text-2xl text-ink">Turn this transcript into a revision pack</h3>
            <p className="mt-1 text-sm sm:text-[15px] text-muted max-w-2xl">
              Structured notes, flashcards and a 10-question quiz. Every point links to the moment it was said.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="bilingual-select" className="text-muted whitespace-nowrap">
                Bilingual cards
              </label>
              <select
                id="bilingual-select"
                value={packSecondLang}
                disabled={packLoading}
                onChange={(e) => setPackSecondLang(e.target.value)}
                className="rounded-md border border-rule bg-surface px-2.5 py-2 text-sm font-medium text-ink focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="">None (Original only)</option>
                {BILINGUAL_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    + {lang}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={packLoading}
              onClick={() => makeRevisionPack()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md font-semibold text-[15px] text-white bg-accent hover:bg-accent-dark disabled:opacity-60 transition-colors"
            >
              {packLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Building revision pack…</span>
                </>
              ) : (
                <span>Make my revision pack</span>
              )}
            </button>
          </div>
        </div>

        {packLoading && packProgress && (
          <div className="mt-5 pt-4 border-t border-rule">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-ink">{packProgress.stage}</span>
              <span className="font-mono text-xs text-muted">
                Step {packProgress.step} of {packProgress.totalSteps} · {packProgress.percent}%
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{packProgress.detail}</p>
            <div className="mt-2.5 h-1 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                style={{ width: `${packProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {packError && (
          <div role="alert" className="mt-4 p-3.5 rounded-md bg-red-50 border border-red-200 text-red-900 text-sm">
            {packError}
            {/limit|used all|upgrade|quiz per day/i.test(packError) && (
              <a
                href="/pricing"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/pricing');
                }}
                className="ml-2 inline-flex items-center px-3 py-1 rounded-md bg-ink text-white text-xs font-semibold"
              >
                See plans & upgrade →
              </a>
            )}
          </div>
        )}
      </div>

      {/* GENERATED REVISION PACK VIEW */}
      {revisionPack && (
        <div ref={packSectionRef} className="scroll-mt-24">
          <RevisionPackView
            pack={revisionPack}
            localMediaUrl={result.localMediaUrl}
            sourceUrl={sourceUrl}
            isRegenerating={packLoading}
            onRegenerateWithLanguage={(lang) => makeRevisionPack(lang)}
            onCardReviewed={(card, rating) =>
              onCardReviewed?.(revisionPack.id, card, rating)
            }
            onBuildMissedDeck={(missed) =>
              onBuildMissedDeck?.(revisionPack.title, missed)
            }
            onOpenFullStudyPage={onOpenFullStudyPage}
          />
        </div>
      )}

      {/* EXISTING TIMESTAMPED TRANSCRIPT TOOL */}
      <section
        id="transcript-result"
        className="rounded-lg bg-surface border border-rule"
      >
        {/* 1. Video Metadata Card Header */}
        <div className="p-4 sm:p-6 border-b border-rule bg-slate-50/70 rounded-t-2xl">
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
            {result.videoThumbnailUrl ? (
              <div className="relative shrink-0 w-full sm:w-36 aspect-video rounded-md overflow-hidden bg-slate-900 border border-slate-200/90">
                <img
                  src={result.videoThumbnailUrl}
                  alt={result.videoTitle || 'Video thumbnail'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                {result.videoDurationSeconds ? (
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-mono text-white">
                    {formatTimestamp(result.videoDurationSeconds)}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="flex-1 min-w-0 w-full">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-semibold text-muted">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-soft text-accent border border-accent/20">
                  {providerLabel}
                </span>
                {result.channelTitle && (
                  <span className="text-slate-700 font-medium truncate max-w-[200px] sm:max-w-[260px]">
                    {result.channelTitle}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded bg-white border border-rule uppercase font-mono">
                  {result.language}
                </span>
                {result.videoDurationSeconds && !result.videoThumbnailUrl ? (
                  <span>· {formatTimestamp(result.videoDurationSeconds)}</span>
                ) : null}
                <span>· {words.toLocaleString()} words</span>
                <span>· {segments.length} segments</span>
              </div>

              <h2 className="text-base sm:text-xl font-bold text-ink mt-2 leading-snug break-words">
                {result.videoTitle || 'Transcript'}
              </h2>
            </div>

            <button
              onClick={onReset}
              className="text-xs sm:text-sm font-semibold text-accent hover:text-accent-dark transition-colors shrink-0 self-start sm:self-center"
            >
              Transcribe another →
            </button>
          </div>
        </div>

        {/* 2. View Mode Tabs (Original | AI Transform | Translation) */}
        <div className="px-4 sm:px-6 pt-3 border-b border-rule bg-surface flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-semibold overflow-x-auto whitespace-nowrap">
          <button
            type="button"
            onClick={() => {
              setActiveTab('original');
              setLastContentTab('original');
            }}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === 'original'
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Original Transcript
            {hasEdits && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800">
                Edited
              </span>
            )}
          </button>

          {(transformedText || (aiLoading && activeTab === 'transform')) && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('transform');
                setLastContentTab('transform');
              }}
              className={`pb-3 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                activeTab === 'transform'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <span>{transformLabel}</span>
            </button>
          )}

          {(translatedText || (aiLoading && activeTab === 'translate')) && (
            <button
              type="button"
              onClick={() => setActiveTab('translate')}
              className={`pb-3 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                activeTab === 'translate'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <span>
                
                {translatedSourceKind === 'transform'
                  ? `${translatedSourceLabel} (${translatedLang || 'Translated'})`
                  : translatedLang || 'Translated'}
              </span>
            </button>
          )}
        </div>

        {/* 3. Studio Action Toolbar */}
        <div ref={toolbarRef} className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-surface">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Pill Toggle Switch: Timestamps */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('original');
                setLastContentTab('original');
                setShowTimes((prev) => !prev);
              }}
              className="inline-flex items-center justify-center sm:justify-start gap-2 px-3 py-2 sm:px-3.5 rounded-md border border-rule bg-surface hover:border-slate-300 text-xs sm:text-sm font-semibold text-ink transition-colors"
              title={showTimes ? 'Switch to clean paragraph mode' : 'Show segment timestamps'}
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  showTimes ? 'bg-accent' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    showTimes ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </span>
              <span>Timestamps</span>
            </button>

            {/* In-line Edit Toggle Button */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('original');
                setLastContentTab('original');
                setIsEditing((prev) => !prev);
              }}
              className={`inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 sm:px-3.5 rounded-md border text-xs sm:text-sm font-semibold transition-colors ${
                isEditing
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-rule bg-surface text-ink hover:border-slate-300'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              <span>{isEditing ? 'Done Editing' : 'Edit'}</span>
            </button>

            {/* Copy Button */}
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 sm:px-3.5 rounded-md border border-rule bg-surface hover:border-accent hover:text-accent text-xs sm:text-sm font-semibold text-ink transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            {/* ✨ Transform with AI Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setTransformMenuOpen((prev) => !prev);
                  setTranslateMenuOpen(false);
                  setDownloadMenuOpen(false);
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 sm:px-3.5 rounded-md border border-rule bg-surface hover:border-accent hover:text-accent text-xs sm:text-sm font-semibold text-ink transition-colors"
              >
                <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
                <span className="truncate">Transform with AI</span>
                <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {transformMenuOpen && (
                <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg bg-surface border border-rule py-2 z-30">
                  <div className="px-3.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted border-b border-slate-100">
                    Quick AI Formats
                  </div>
                  {TRANSFORM_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => runTransform(opt)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 transition-colors flex flex-col"
                    >
                      <span className="text-sm font-semibold text-ink">{opt.label}</span>
                      <span className="text-xs text-muted">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 🌐 Translate to Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setTranslateMenuOpen((prev) => !prev);
                  setTransformMenuOpen(false);
                  setDownloadMenuOpen(false);
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-2 sm:px-3.5 rounded-md border border-rule bg-surface hover:border-accent hover:text-accent text-xs sm:text-sm font-semibold text-ink transition-colors"
              >
                <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                  />
                </svg>
                <span>Translate to</span>
                <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {translateMenuOpen && (
                <div className="absolute left-0 mt-2 w-52 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto rounded-lg bg-surface border border-rule py-1.5 z-30">
                  <div className="px-3.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted border-b border-slate-100">
                    Select Language
                  </div>
                  {TRANSLATE_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => runTranslate(lang)}
                      className="w-full text-left px-3.5 py-2 text-sm font-medium text-ink hover:bg-slate-50 hover:text-accent transition-colors"
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ⬇️ Download Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setDownloadMenuOpen((prev) => !prev);
                  setTransformMenuOpen(false);
                  setTranslateMenuOpen(false);
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-1.5 px-4 py-2 rounded-md text-xs sm:text-sm font-semibold bg-accent text-white hover:bg-accent-dark transition-opacity"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download</span>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {downloadMenuOpen && (
                <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg bg-surface border border-rule py-2 z-30">
                  <button
                    type="button"
                    onClick={() => download(activeCopyText, 'txt', 'text/plain')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span className="text-sm font-semibold text-ink">Plain Text (.TXT)</span>
                    <span className="text-[11px] font-mono text-muted">TXT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => download(srtContent, 'srt', 'text/plain')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span className="text-sm font-semibold text-ink">SubRip Subtitles (.SRT)</span>
                    <span className="text-[11px] font-mono text-muted">SRT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => download(vttContent, 'vtt', 'text/vtt')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span className="text-sm font-semibold text-ink">WebVTT Subtitles (.VTT)</span>
                    <span className="text-[11px] font-mono text-muted">VTT</span>
                  </button>
                </div>
              )}
            </div>

            {hasEdits && (
              <button
                type="button"
                onClick={resetEdits}
                className="text-xs font-semibold text-amber-700 hover:underline ml-auto"
              >
                Reset Edits
              </button>
            )}
          </div>

          {/* Search Input (shown on Original tab) */}
          {activeTab === 'original' && (
            <div className="mt-3.5 flex flex-wrap items-center gap-3">
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
                  className="w-full pl-9 pr-3 py-1.5 text-base sm:text-sm rounded-md border border-rule bg-slate-50/60 text-ink placeholder:text-slate-400 focus:bg-surface focus:outline-none focus:border-accent"
                />
              </div>
              {q && (
                <span className="text-xs font-semibold text-muted">
                  Showing {visible.length} of {segments.length} segments
                </span>
              )}
              {isEditing && (
                <span className="text-xs font-medium text-accent">
                  Click any line below to edit words before exporting .TXT or .SRT
                </span>
              )}
            </div>
          )}
        </div>

        {/* 4. Main Content Area */}
        <div className="bg-surface">
          {aiError && activeTab !== 'original' && (
            <div className="m-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
              {aiError}
            </div>
          )}

          {aiLoading && activeTab !== 'original' ? (
            <div className="p-10 sm:p-14 flex flex-col items-center justify-center text-center">
              <div className="w-full max-w-md rounded-lg bg-slate-50/90 border border-rule p-5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-2 font-bold text-ink text-sm">
                    <svg className="w-4 h-4 text-accent animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span>
                      {aiProgress?.stage ||
                        (activeTab === 'transform'
                          ? `Writing your ${transformLabel}…`
                          : `Translating into ${translatedLang}…`)}
                    </span>
                  </span>
                  {aiProgress && (
                    <span className="font-mono text-xs text-muted shrink-0">
                      Step {aiProgress.step} of {aiProgress.totalSteps} · {aiProgress.percent}%
                    </span>
                  )}
                </div>
                {aiProgress?.detail && (
                  <p className="mt-1.5 text-xs text-muted text-left pl-6">{aiProgress.detail}</p>
                )}
                <div className="mt-3.5 h-1 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                    style={{ width: `${aiProgress?.percent ?? 45}%` }}
                  />
                </div>
              </div>
            </div>
          ) : activeTab === 'transform' && transformedText ? (
            <div className="p-6 sm:p-8 max-h-[68vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <span className="text-xs font-mono uppercase tracking-wider font-semibold text-accent">
                  {transformLabel}
                </span>
                <button
                  type="button"
                  onClick={() => download(transformedText, 'txt', 'text/plain', `-${transformLabel.toLowerCase().replace(/\s+/g, '-')}`)}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Download .TXT →
                </button>
              </div>
              <FormattedContent text={transformedText} />
            </div>
          ) : activeTab === 'translate' && translatedText ? (
            <div className="max-h-[68vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 sm:px-8 pt-6 pb-3 border-b border-slate-100">
                <span className="text-xs font-mono uppercase tracking-wider font-semibold text-accent">
                  
                  {translatedSourceKind === 'transform'
                    ? `${translatedSourceLabel} · ${translatedLang}`
                    : `Translated to ${translatedLang}`}
                </span>
                <button
                  type="button"
                  onClick={() => download(translatedText, 'txt', 'text/plain', `-${translatedLang.toLowerCase()}`)}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Download .TXT →
                </button>
              </div>
              {parsedTranslatedTimestamps ? (
                <>
                  <ol
                    dir={translatedLang === 'Arabic' ? 'rtl' : 'auto'}
                    className="divide-y divide-slate-100"
                  >
                    {parsedTranslatedTimestamps.items.map((item, idx) => (
                      <li
                        key={`${item.timestamp}-${idx}`}
                        className="flex items-start gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-3.5 hover:bg-slate-50/80 transition-colors"
                      >
                        <span className="shrink-0 pt-0.5" dir="ltr">
                          {result.provider === 'youtube' ? (
                            <a
                              href={`https://www.youtube.com/watch?v=${result.videoId}&t=${Math.floor(item.seconds)}s`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open at this moment on YouTube"
                              className="inline-block font-mono text-xs font-semibold px-2 py-1 rounded-md bg-accent-soft text-accent hover:bg-accent hover:text-white transition-colors"
                            >
                              {item.timestamp}
                            </a>
                          ) : (
                            <span className="inline-block font-mono text-xs font-semibold px-2 py-1 rounded-md bg-accent-soft text-accent">
                              {item.timestamp}
                            </span>
                          )}
                        </span>
                        <p dir="auto" className="text-[15px] text-ink leading-relaxed break-words min-w-0 flex-1">{item.text}</p>
                      </li>
                    ))}
                  </ol>
                  {parsedTranslatedTimestamps.trailingNote && (
                    <p className="px-6 py-3 text-xs text-muted border-t border-slate-100">
                      {parsedTranslatedTimestamps.trailingNote}
                    </p>
                  )}
                </>
              ) : (
                <div
                  dir={translatedLang === 'Arabic' ? 'rtl' : 'auto'}
                  className="p-6 sm:p-8 pt-5"
                >
                  <FormattedContent text={translatedText} />
                </div>
              )}
            </div>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-muted">No transcript lines match “{q}”.</p>
          ) : !showTimes && !isEditing ? (
            /* Clean Article Paragraph View when Timestamps are toggled OFF */
            <div className="p-6 sm:p-8 space-y-5 max-h-[68vh] overflow-y-auto">
              {paragraphs.map((para) => (
                <p key={para.id} dir="auto" className="text-[15.5px] text-ink leading-relaxed">
                  {highlight(para.text)}
                </p>
              ))}
            </div>
          ) : (
            /* Timestamped Segment View (with optional In-Line Editing) */
            <ol className="divide-y divide-slate-100 max-h-[68vh] overflow-y-auto">
              {visible.map((seg) => (
                <li
                  key={seg.id}
                  className="flex items-start gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-3.5 hover:bg-slate-50/80 transition-colors"
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

                  {isEditing ? (
                    <input
                      type="text"
                      value={seg.text}
                      onChange={(e) => handleSegmentChange(seg.id, e.target.value)}
                      className="w-full min-w-0 flex-1 px-2.5 py-1 text-base sm:text-[15px] text-ink bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-accent"
                    />
                  ) : (
                    <p dir="auto" className="text-[15px] text-ink leading-relaxed break-words min-w-0 flex-1">{highlight(seg.text)}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Bottom Word Count Footer */}
        <div className="px-4 sm:px-6 py-3 bg-slate-50/70 border-t border-rule rounded-b-2xl flex items-center justify-between text-xs font-medium text-muted">
          <span>{words.toLocaleString()} words · {segments.length} segments</span>
          <span>TXT · SRT · VTT · PDF · Anki CSV</span>
        </div>
      </section>
    </div>
  );
};
