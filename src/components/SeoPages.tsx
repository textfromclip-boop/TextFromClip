import React from 'react';
import { Video, FileVideo, Sparkles } from 'lucide-react';

interface SeoPagesProps {
  onSelectKeyword: (presetUrl?: string) => void;
}

export const SeoPages: React.FC<SeoPagesProps> = ({ onSelectKeyword }) => {
  return (
    <section className="py-16 bg-white dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">
            Popular Solutions
          </h2>
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Transcribe Any Video Format Instantly
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          
          {/* YouTube Transcript Card */}
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-950/80 text-red-600 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                YouTube Transcript Generator
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                Extract complete timestamped transcripts from any YouTube video, Shorts, or podcast episode. Download ready-to-use TXT or SRT subtitle files without leaving your browser.
              </p>
            </div>
            <button
              onClick={() => onSelectKeyword('https://www.youtube.com/watch?v=jNQXAC9IVRw')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              <span>Try YouTube Transcript</span>
              <span>→</span>
            </button>
          </div>

          {/* Universal Video to Text Card */}
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-600 flex items-center justify-center mb-4">
                <FileVideo className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                Universal Video to Text
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                Convert direct MP4, WebM, or audio clips into readable, search-indexed text using state-of-the-art speech recognition at the edge. No software installs required.
              </p>
            </div>
            <button
              onClick={() => onSelectKeyword()}
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              <span>Transcribe Video File</span>
              <span>→</span>
            </button>
          </div>

        </div>

      </div>
    </section>
  );
};
