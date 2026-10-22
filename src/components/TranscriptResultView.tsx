import React, { useState, useMemo } from 'react';
import { TranscriptResult } from '../types';
import { formatTimestamp } from '../server/utils/formatters';
import {
  Copy,
  Check,
  Download,
  RotateCcw,
  Search,
  Clock,
  Sparkles,
  ExternalLink,
  FileText,
  Subtitles,
  HelpCircle
} from 'lucide-react';

interface TranscriptResultViewProps {
  result: TranscriptResult;
  onReset: () => void;
}

export const TranscriptResultView: React.FC<TranscriptResultViewProps> = ({
  result,
  onReset,
}) => {
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTimestamps, setShowTimestamps] = useState(true);

  // Filter segments based on live search query
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return result.segments;
    const query = searchQuery.toLowerCase();
    return result.segments.filter((seg) => seg.text.toLowerCase().includes(query));
  }, [result.segments, searchQuery]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(label);
    setTimeout(() => setCopiedType(null), 2500);
  };

  // Download helper for TXT, SRT, VTT
  const handleDownload = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const sanitizeFilename = (title?: string) => {
    if (!title) return 'transcript';
    return title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50);
  };

  const baseFileName = sanitizeFilename(result.videoTitle);

  return (
    <section id="transcript-result" className="py-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        
        {/* Top Header Card */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {/* Provider Tag */}
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                  {result.provider.toUpperCase()}
                </span>

                {/* Source Badge */}
                {result.sourceType === 'captions' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                    <Check className="w-3 h-3" /> Official Captions
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                    <Sparkles className="w-3 h-3" /> Workers AI Whisper
                  </span>
                )}

                {/* Language */}
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase">
                  Language: {result.language}
                </span>

                {/* Duration */}
                {result.videoDurationSeconds ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    • {formatTimestamp(result.videoDurationSeconds)}
                  </span>
                ) : null}
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-snug">
                {result.videoTitle || 'Transcribed Clip'}
              </h2>
            </div>

            {/* Transcribe Another Video Button */}
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Transcribe Another</span>
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
            
            {/* Search Input Filter */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search words in transcript..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Timestamp Toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showTimestamps}
                onChange={(e) => setShowTimestamps(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
              />
              <Clock className="w-3.5 h-3.5" />
              <span>Show Timestamps</span>
            </label>

            {/* Export and Copy Actions */}
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              
              {/* Copy Full Text */}
              <button
                onClick={() => handleCopy(result.fullText, 'text')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm transition-all"
              >
                {copiedType === 'text' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedType === 'text' ? 'Copied!' : 'Copy Text'}</span>
              </button>

              {/* Download TXT */}
              <button
                onClick={() => handleDownload(result.fullText, `${baseFileName}.txt`, 'text/plain')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title="Download plain text (.txt)"
              >
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                <span>TXT</span>
              </button>

              {/* Download SRT */}
              {result.srt ? (
                <button
                  onClick={() => handleDownload(result.srt, `${baseFileName}.srt`, 'text/plain')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  title="Download SubRip subtitles (.srt)"
                >
                  <Subtitles className="w-3.5 h-3.5 text-purple-500" />
                  <span>SRT</span>
                </button>
              ) : null}

              {/* Download VTT */}
              {result.vtt ? (
                <button
                  onClick={() => handleDownload(result.vtt, `${baseFileName}.vtt`, 'text/vtt')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  title="Download WebVTT subtitles (.vtt)"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  <span>VTT</span>
                </button>
              ) : null}

            </div>

          </div>
        </div>

        {/* Transcript Body Viewer */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card p-6 sm:p-8">
          
          {filteredSegments.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <p>No matching lines found for "{searchQuery}".</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Clear search query
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSegments.map((segment) => {
                // Highlight search matches
                const text = segment.text;
                let renderedText: React.ReactNode = text;
                if (searchQuery.trim()) {
                  const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
                  renderedText = parts.map((part, i) =>
                    part.toLowerCase() === searchQuery.toLowerCase() ? (
                      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/60 text-slate-900 dark:text-white px-0.5 rounded">
                        {part}
                      </mark>
                    ) : (
                      part
                    )
                  );
                }

                // If YouTube, create a jump link
                const youtubeJumpUrl =
                  result.provider === 'youtube'
                    ? `https://www.youtube.com/watch?v=${result.videoId}&t=${Math.floor(segment.start)}s`
                    : null;

                return (
                  <div
                    key={segment.id}
                    className="group flex items-start gap-4 p-2 -mx-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    {showTimestamps && (
                      <div className="shrink-0 pt-0.5">
                        {youtubeJumpUrl ? (
                          <a
                            href={youtubeJumpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Jump to ${formatTimestamp(segment.start)} on YouTube`}
                            className="inline-flex items-center gap-1 font-mono text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                          >
                            <span>{formatTimestamp(segment.start)}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100" />
                          </a>
                        ) : (
                          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {formatTimestamp(segment.start)}
                          </span>
                        )}
                      </div>
                    )}

                    <p className="text-slate-800 dark:text-slate-200 text-sm sm:text-base leading-relaxed flex-1">
                      {renderedText}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Transcript Footer Info */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-500 gap-2">
            <div className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>
                Processed with TextFromClip provider adapter • Ephemeral retention policy
              </span>
            </div>
            <span>
              {result.segments.length} segments • {result.fullText.split(/\s+/).length} words
            </span>
          </div>

        </div>

      </div>
    </section>
  );
};
