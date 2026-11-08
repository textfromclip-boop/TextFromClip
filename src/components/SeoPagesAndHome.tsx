import React from 'react';
import { Link } from '../router';
import { TranscribePage, PlatformConfig } from './TranscribePage';

export interface SeoLandingSpec {
  path: string;
  title: string;
  eyebrow: string;
  headingPrefix: string;
  headingHighlight: string;
  intro: string;
  bilingualLanguage?: string;
}

export const SEO_LANDING_PAGES: Record<string, SeoLandingSpec> = {
  '/youtube-lecture-to-flashcards': {
    path: '/youtube-lecture-to-flashcards',
    title: 'YouTube Lecture to Flashcards',
    eyebrow: 'YouTube Lecture → Active-Recall Cards',
    headingPrefix: 'YouTube lecture →',
    headingHighlight: 'verified flashcards.',
    intro:
      'Paste any YouTube lecture link to get a timestamped transcript and 30 quote-verified flashcards ready for spaced repetition or Anki export.',
  },
  '/lecture-to-notes': {
    path: '/lecture-to-notes',
    title: 'Lecture to Structured Notes',
    eyebrow: 'Lecture Recording → Structured Notes',
    headingPrefix: '2-hour lecture →',
    headingHighlight: 'structured study notes.',
    intro:
      'Upload a lecture recording or paste a YouTube link to generate organized sections, key definitions, and verbatim lecture quotes linked to exact timestamps.',
  },
  '/video-to-quiz': {
    path: '/video-to-quiz',
    title: 'Video to Multiple-Choice Quiz',
    eyebrow: 'Lecture Video → 10-Question Mock Exam',
    headingPrefix: 'Turn any lecture video into a',
    headingHighlight: '10-question quiz.',
    intro:
      'Test yourself before exam day with 10 multiple-choice questions, instant answer explanations, and clickable lecture timestamps.',
  },
  '/youtube-to-text': {
    path: '/youtube-to-text',
    title: 'YouTube to Text Transcript',
    eyebrow: 'Free YouTube Transcript Generator',
    headingPrefix: 'Turn YouTube videos into',
    headingHighlight: 'searchable text.',
    intro:
      'Paste any public YouTube video or lecture link to read, search, edit, and export a clean timestamped transcript (.TXT, .SRT, .VTT) in seconds.',
  },
  '/youtube-transcript-to-pdf': {
    path: '/youtube-transcript-to-pdf',
    title: 'YouTube Transcript to PDF Study Pack',
    eyebrow: 'YouTube → Printable PDF Revision Pack',
    headingPrefix: 'YouTube transcript →',
    headingHighlight: 'clean PDF study pack.',
    intro:
      'Convert any YouTube lecture into a printable PDF containing structured notes, active-recall flashcards, and a 10-question practice quiz.',
  },
  '/flashcards-in-arabic': {
    path: '/flashcards-in-arabic',
    title: 'Bilingual Lecture Flashcards in Arabic',
    eyebrow: 'Bilingual Study Pack · العربية',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'Arabic translation.',
    intro:
      'Keep original English technical terms alongside natural right-to-left Arabic translations underneath every flashcard, including RTL-safe PDF and Anki exports.',
    bilingualLanguage: 'Arabic',
  },
  '/flashcards-in-spanish': {
    path: '/flashcards-in-spanish',
    title: 'Bilingual Lecture Flashcards in Spanish',
    eyebrow: 'Bilingual Study Pack · Español',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'Spanish translation.',
    intro:
      'Generate quote-verified flashcards that keep the original lecture text and add a clear Spanish translation underneath each card.',
    bilingualLanguage: 'Spanish',
  },
  '/flashcards-in-french': {
    path: '/flashcards-in-french',
    title: 'Bilingual Lecture Flashcards in French',
    eyebrow: 'Bilingual Study Pack · Français',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'French translation.',
    intro:
      'Generate quote-verified flashcards that keep the original lecture text and add a natural French translation underneath each card.',
    bilingualLanguage: 'French',
  },
  '/flashcards-in-german': {
    path: '/flashcards-in-german',
    title: 'Bilingual Lecture Flashcards in German',
    eyebrow: 'Bilingual Study Pack · Deutsch',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'German translation.',
    intro:
      'Generate quote-verified flashcards that keep the original lecture text and add an accurate German translation underneath each card.',
    bilingualLanguage: 'German',
  },
  '/flashcards-in-turkish': {
    path: '/flashcards-in-turkish',
    title: 'Bilingual Lecture Flashcards in Turkish',
    eyebrow: 'Bilingual Study Pack · Türkçe',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'Turkish translation.',
    intro:
      'Generate quote-verified flashcards that keep the original lecture text and add a natural Turkish translation underneath each card.',
    bilingualLanguage: 'Turkish',
  },
  '/flashcards-in-portuguese': {
    path: '/flashcards-in-portuguese',
    title: 'Bilingual Lecture Flashcards in Portuguese',
    eyebrow: 'Bilingual Study Pack · Português',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'Portuguese translation.',
    intro:
      'Generate quote-verified flashcards that keep the original lecture text and add a clear Portuguese translation underneath each card.',
    bilingualLanguage: 'Portuguese',
  },
  '/flashcards-in-hindi': {
    path: '/flashcards-in-hindi',
    title: 'Bilingual Lecture Flashcards in Hindi',
    eyebrow: 'Bilingual Study Pack · हिन्दी',
    headingPrefix: 'Lecture flashcards with',
    headingHighlight: 'Hindi translation.',
    intro:
      'Generate quote-verified flashcards that keep the original lecture text and add a clear Hindi translation underneath each card.',
    bilingualLanguage: 'Hindi',
  },
};

export const HomeSectionsBelowTool: React.FC = () => (
  <div className="max-w-6xl mx-auto px-4 sm:px-5 pb-16 space-y-16">
    {/* 1. The 2-Minute Demo Flow */}
    <section aria-label="How LearnFromClip works in 2 minutes" className="pt-8 border-t border-rule">
      <div className="text-center max-w-2xl mx-auto">
        <span className="inline-block px-3 py-1 rounded-full bg-accent-soft text-accent text-xs font-bold">
          The 2-Minute Study Workflow
        </span>
        <h2 className="mt-3 text-2xl sm:text-4xl font-black tracking-tight text-ink">
          A lecture goes in. A trustworthy study pack comes out.
        </h2>
        <p className="mt-2 text-sm sm:text-base text-muted">
          No generic AI fluff. Every single note, flashcard, and quiz question is anchored to a verified quote from your lecturer.
        </p>
      </div>

      <div className="mt-8 grid md:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-rule bg-surface p-6 shadow-sm">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent font-mono font-bold text-sm">
            1
          </span>
          <h3 className="mt-3 text-base font-extrabold text-ink">
            Paste a link or upload audio/video
          </h3>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">
            Works with YouTube lectures, TikToks, Instagram Reels, or local MP4/MP3/WAV recordings up to 2 hours free (4 hours on paid passes).
          </p>
        </div>

        <div className="rounded-2xl border border-rule bg-surface p-6 shadow-sm">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent font-mono font-bold text-sm">
            2
          </span>
          <h3 className="mt-3 text-base font-extrabold text-ink">
            Click “Make my revision pack”
          </h3>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">
            Generates structured notes, 30 flashcards (with optional bilingual translation), and a 10-question quiz—dropping any item whose quote isn’t found in the transcript.
          </p>
        </div>

        <div className="rounded-2xl border border-rule bg-surface p-6 shadow-sm">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent font-mono font-bold text-sm">
            3
          </span>
          <h3 className="mt-3 text-base font-extrabold text-ink">
            Review daily or export anywhere
          </h3>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">
            Flip cards with SM-2 spaced repetition, click <strong>From lecture · 12:04</strong> to replay the exact moment, or export to PDF, Anki CSV, and Markdown.
          </p>
        </div>
      </div>
    </section>

    {/* 2. Product Preview Showcase (Accuracy & Source Verification) */}
    <section
      aria-label="Source-linked revision pack preview"
      className="rounded-2xl bg-gradient-to-r from-[#021433] via-[#0B2559] to-[#1E1B4B] p-6 sm:p-10 text-white shadow-xl"
    >
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-5">
          <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-bold">
            Zero Hallucinated Facts
          </span>
          <h2 className="mt-3 text-2xl sm:text-3xl font-black leading-tight text-white">
            Every point proves where it came from.
          </h2>
          <p className="mt-3 text-sm text-slate-300 leading-relaxed">
            Every note bullet, flashcard, and quiz question carries an exact word-for-word quote verified against your transcript. Anything the AI adds for extra clarity is placed in a separate <strong>AI explanation</strong> box—never mixed into what your professor said.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/study"
              className="px-4 py-2.5 rounded-xl bg-white text-[#021433] font-bold text-xs sm:text-sm"
            >
              Open Study Mode →
            </Link>
            <Link
              to="/pricing"
              className="px-4 py-2.5 rounded-xl bg-white/10 text-white border border-white/20 font-bold text-xs sm:text-sm"
            >
              See Exam & Semester Passes
            </Link>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="rounded-2xl bg-surface text-ink p-5 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Sample Verified Note & Flashcard
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-soft text-accent">
                ▶ From lecture · 12:04
              </span>
            </div>
            <p className="text-sm font-semibold text-ink">
              <span className="font-bold bg-amber-100 px-1.5 py-0.5 rounded mr-1.5">
                Oxidative Phosphorylation:
              </span>
              Occurs across the inner mitochondrial membrane via the electron transport chain to synthesize ATP.
            </p>
            <p className="text-xs text-muted italic border-l-2 border-slate-300 pl-2.5">
              Verbatim lecture quote: “Oxidative phosphorylation occurs across the inner mitochondrial membrane via the electron transport chain.”
            </p>
            <div className="p-3 rounded-xl bg-[#F5F3FF] border border-[#502EF0]/25 text-xs text-[#1E1B4B]">
              <span className="inline-block px-2 py-0.5 mr-2 rounded bg-[#502EF0] text-white font-bold text-[10px] uppercase">
                AI explanation
              </span>
              Complexes I–IV establish the proton gradient that drives ATP synthase (Complex V).
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* 3. Pricing Teaser */}
    <section aria-label="Pricing teaser" className="rounded-2xl border border-rule bg-surface p-6 sm:p-8 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="text-xs font-mono font-bold uppercase text-accent">
            Built for Student Budgets
          </span>
          <h2 className="mt-1 text-2xl font-black text-ink">
            Free forever to start. Exam Pass from $2.99.
          </h2>
          <p className="mt-1 text-sm text-muted">
            Less than the price of one coffee a month. No account needed on the free plan—your notes stay on your device.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Link
            to="/pricing"
            className="px-5 py-3 rounded-xl font-extrabold text-xs sm:text-sm text-white bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] shadow-md"
          >
            Compare Free, Exam & Semester Passes →
          </Link>
        </div>
      </div>
    </section>

    {/* 4. Student FAQ */}
    <section aria-label="Frequently Asked Questions">
      <h2 className="text-2xl font-black text-ink mb-5">Frequently Asked Questions</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-rule bg-surface p-5">
          <h3 className="font-bold text-ink text-sm sm:text-base">
            How do I know the AI didn’t make up facts?
          </h3>
          <p className="mt-1.5 text-xs sm:text-sm text-muted leading-relaxed">
            Every note bullet, flashcard, and quiz question must carry a word-for-word quote from the lecture transcript. Our server checks every quote against the transcript and automatically drops any item that cannot be verified.
          </p>
        </div>
        <div className="rounded-2xl border border-rule bg-surface p-5">
          <h3 className="font-bold text-ink text-sm sm:text-base">
            Do I need an account to use LearnFromClip?
          </h3>
          <p className="mt-1.5 text-xs sm:text-sm text-muted leading-relaxed">
            No account needed. On the free plan, your notes, decks, and spaced-repetition schedule stay on your device in your browser.
          </p>
        </div>
        <div className="rounded-2xl border border-rule bg-surface p-5">
          <h3 className="font-bold text-ink text-sm sm:text-base">
            Does the 7-day Exam Pass or Semester Pass auto-renew?
          </h3>
          <p className="mt-1.5 text-xs sm:text-sm text-muted leading-relaxed">
            Never. Both the 7-day Exam Pass ($2.99) and the 4-month Semester Pass ($14.99) are one-time payments with zero auto-renewal.
          </p>
        </div>
        <div className="rounded-2xl border border-rule bg-surface p-5">
          <h3 className="font-bold text-ink text-sm sm:text-base">
            Can I study flashcards in Arabic, Spanish, or Turkish?
          </h3>
          <p className="mt-1.5 text-xs sm:text-sm text-muted leading-relaxed">
            Yes! Choose a second language (Arabic, Spanish, French, German, Turkish, Portuguese, or Hindi) to keep the original lecture terminology on top and add a fluent translation underneath, including RTL Arabic PDF and Anki exports.
          </p>
        </div>
      </div>
    </section>
  </div>
);

export const SeoLandingPage: React.FC<{
  spec: SeoLandingSpec;
  baseConfig: PlatformConfig;
}> = ({ spec, baseConfig }) => {
  const customConfig: PlatformConfig = {
    ...baseConfig,
    eyebrow: spec.eyebrow,
    headingPrefix: spec.headingPrefix,
    headingHighlight: spec.headingHighlight,
    intro: spec.intro,
  };

  return (
    <div>
      <TranscribePage config={customConfig} />
      <HomeSectionsBelowTool />
    </div>
  );
};
