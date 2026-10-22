import React, { useState } from 'react';
import {
  Link as LinkIcon,
  ArrowRight,
  Sparkles,
  Zap,
  CheckCircle2,
  Globe,
  ShieldCheck,
  Loader2,
  Copy,
  Play,
  Volume2,
  AlertCircle
} from 'lucide-react';

interface HeroProps {
  onTranscribe: (url: string) => void;
  isLoading: boolean;
  errorMessage: string | null;
  clearError: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onTranscribe,
  isLoading,
  errorMessage,
  clearError,
}) => {
  const [inputUrl, setInputUrl] = useState('');
  const [copiedSample, setCopiedSample] = useState(false);

  const sampleUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // First YouTube video ever uploaded (has verified captions!)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    clearError();
    onTranscribe(inputUrl.trim());
  };

  const handleSampleClick = (url: string) => {
    setInputUrl(url);
    clearError();
    onTranscribe(url);
  };

  const handleCopyMock = () => {
    setCopiedSample(true);
    setTimeout(() => setCopiedSample(false), 2000);
  };

  return (
    <section id="hero" className="relative pt-6 pb-20 overflow-hidden">
      {/* Background radial gradient glow */}
      <div className="absolute top-0 right-1/4 -z-10 w-96 h-96 bg-blue-100/50 dark:bg-blue-900/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-20 left-1/4 -z-10 w-96 h-96 bg-purple-100/40 dark:bg-purple-900/15 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column: Input and Value Proposition */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            
            {/* Trust Pill Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs sm:text-sm font-medium mb-6 shadow-sm">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Fast · Accurate · No Signup Required</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.12] mb-6">
              Turn Video Clips <br className="hidden sm:inline" />
              into <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Text</span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-normal leading-relaxed mb-8 max-w-xl">
              Paste a video link, and get a clean, accurate transcript in seconds. No downloads, no signup, no hassle.
            </p>

            {/* URL Input Form Container */}
            <div id="transcribe-section" className="w-full max-w-2xl mb-4">
              <form
                onSubmit={handleSubmit}
                className="relative flex flex-col sm:flex-row items-center p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card hover:shadow-card-hover transition-all duration-200 focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-blue-500"
              >
                <div className="flex items-center w-full px-3 py-2 sm:py-0">
                  <LinkIcon className="w-5 h-5 text-blue-500 shrink-0 mr-3" />
                  <input
                    type="url"
                    value={inputUrl}
                    onChange={(e) => {
                      setInputUrl(e.target.value);
                      if (errorMessage) clearError();
                    }}
                    placeholder="Paste your video link here..."
                    required
                    disabled={isLoading}
                    className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-base focus:outline-none disabled:opacity-50"
                  />
                  {inputUrl && !isLoading && (
                    <button
                      type="button"
                      onClick={() => setInputUrl('')}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-2 py-1 rounded"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !inputUrl.trim()}
                  className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Transcribing...</span>
                    </>
                  ) : (
                    <>
                      <span>Get Transcript</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Sample link quick-fill */}
              <div className="flex items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400">
                <span>Try sample:</span>
                <button
                  type="button"
                  onClick={() => handleSampleClick(sampleUrl)}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  YouTube "Me at the zoo" (Verified Captions)
                </button>
              </div>

              {/* Error Message Alert */}
              {errorMessage && (
                <div className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 flex items-start gap-3 animate-in fade-in">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-800 dark:text-red-300">
                    <p className="font-semibold mb-0.5">Extraction Notice</p>
                    <p>{errorMessage}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Works With Platforms Badge List */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-10 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Works with:</span>
              
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/80 font-medium text-slate-800 dark:text-slate-200">
                <svg className="w-4 h-4 text-red-600 fill-current" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <span>YouTube</span>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/80 font-medium text-slate-800 dark:text-slate-200">
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-.88-.06A6.34 6.34 0 0 0 3 15.68a6.34 6.34 0 0 0 10.82 4.49 6.27 6.27 0 0 0 1.86-4.5V8.55a8.28 8.28 0 0 0 4.84 1.55v-3.41z"/>
                </svg>
                <span>TikTok</span>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800/80 font-medium text-slate-800 dark:text-slate-200">
                <svg className="w-3.5 h-3.5 text-pink-600 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
                <span>Instagram</span>
              </div>

              <span className="text-slate-400">+ MP4 / Audio URLs</span>
            </div>

            {/* 4 Feature Highlights Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 mb-1">
                  <Zap className="w-4 h-4" />
                  <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">Fast Results</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Get your transcript in seconds.</p>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">High Accuracy</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Reliable and clear transcriptions.</p>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 mb-1">
                  <Globe className="w-4 h-4" />
                  <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">Works Everywhere</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">On any device, anytime.</p>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 mb-1">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">100% Free</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">No account needed. No hidden fees.</p>
              </div>
            </div>

          </div>

          {/* Right Column: Visual Interface Illustration Matching Reference Image */}
          <div className="lg:col-span-5 relative flex justify-center items-center">
            
            {/* Ambient backdrop glow */}
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 to-purple-500/10 rounded-3xl blur-2xl transform -rotate-3" />

            <div className="relative w-full max-w-md pt-8">
              
              {/* Floating Source URL Pill with Curved Arrow */}
              <div className="absolute -top-1 left-2 sm:left-6 z-20 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-600 text-white text-xs font-mono shadow-md">
                <LinkIcon className="w-3.5 h-3.5" />
                <span>https://youtube.com/watch?v=abc123</span>
              </div>

              {/* Curved Arrow SVG */}
              <svg
                className="absolute top-4 right-14 sm:right-20 z-20 w-16 h-12 text-blue-500 pointer-events-none"
                viewBox="0 0 60 50"
                fill="none"
              >
                <path
                  d="M10 10 Q 40 5, 45 35"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M38 30 L 45 38 L 50 28"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>

              {/* Underlying Video Player Card */}
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 shadow-xl w-4/5 ml-0 mb-6">
                {/* Coastal / Ocean scenic mock thumbnail */}
                <div className="h-44 sm:h-48 w-full relative bg-gradient-to-br from-cyan-600 via-blue-700 to-indigo-900 overflow-hidden flex items-end">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                  
                  {/* Subtle island silhouette */}
                  <svg className="absolute bottom-0 inset-x-0 w-full h-24 text-teal-900/60 fill-current" viewBox="0 0 300 80" preserveAspectRatio="none">
                    <path d="M0,80 L0,50 Q40,20 80,45 Q120,70 170,30 Q220,-10 260,40 Q280,65 300,50 L300,80 Z" />
                  </svg>

                  {/* Playhead overlay bar */}
                  <div className="relative w-full p-3 text-white text-xs z-10">
                    <div className="w-full bg-white/30 h-1 rounded-full mb-2 overflow-hidden">
                      <div className="bg-blue-400 h-full w-1/4 rounded-full" />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span className="font-mono text-[11px]">0:00 / 2:34</span>
                      </div>
                      <Volume2 className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Overlapping Floating Transcript Card */}
              <div className="relative -mt-28 ml-auto w-11/12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 sm:p-5 z-10 transition-all hover:shadow-glow">
                
                {/* Transcript Card Header */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Transcript</h3>
                  <button
                    onClick={handleCopyMock}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 transition-colors px-2 py-1 rounded bg-slate-50 dark:bg-slate-800"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedSample ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>

                {/* Timestamped Transcript Lines */}
                <div className="space-y-3 font-sans text-xs sm:text-[13px] leading-relaxed">
                  <div className="flex items-start gap-2.5">
                    <span className="font-mono text-blue-600 dark:text-blue-400 font-medium shrink-0">00:00</span>
                    <p className="text-slate-700 dark:text-slate-300">
                      Welcome to our travel vlog! Today we're exploring one of the most beautiful places in the world.
                    </p>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span className="font-mono text-blue-600 dark:text-blue-400 font-medium shrink-0">00:12</span>
                    <p className="text-slate-700 dark:text-slate-300">
                      The weather is amazing, and the views are absolutely breathtaking.
                    </p>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span className="font-mono text-blue-600 dark:text-blue-400 font-medium shrink-0">00:28</span>
                    <p className="text-slate-700 dark:text-slate-300">
                      Let's take a closer look at this incredible destination and what makes it so special.
                    </p>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <span className="font-mono text-blue-600 dark:text-blue-400 font-medium shrink-0">01:05</span>
                    <p className="text-slate-700 dark:text-slate-300">
                      If you're planning a trip, make sure to add this place to your bucket list!
                    </p>
                  </div>
                </div>

              </div>

            </div>

          </div>

        </div>

        {/* Social Proof Strip at bottom of Hero */}
        <div className="mt-16 pt-10 border-t border-slate-100 dark:border-slate-800/80 text-center">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mb-6">
            Trusted by creators, students, journalists, and professionals worldwide
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-12 opacity-65 grayscale hover:grayscale-0 transition-all duration-300">
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              YouTube
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              TikTok
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              Instagram
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              X (Twitter)
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              LinkedIn
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              Reddit
            </span>
          </div>
        </div>

      </div>
    </section>
  );
};
