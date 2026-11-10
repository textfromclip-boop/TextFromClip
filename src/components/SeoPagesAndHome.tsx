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

const HOME_STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Paste a link or upload a recording',
    body: 'YouTube lectures, TikToks, Instagram Reels, or an MP4, MP3 or WAV from your device. Up to 2 hours free, 4 hours on a paid pass.',
  },
  {
    title: 'Make your revision pack',
    body: 'You get structured notes, up to 30 flashcards and a 10-question quiz. Anything whose quote is not in the transcript is thrown away.',
  },
  {
    title: 'Study it, or take it with you',
    body: (
      <>
        Review cards with spaced repetition, tap <span className="font-mono text-[13px] text-accent">From lecture · 12:04</span> to
        replay the moment, or export to PDF, Anki and Markdown.
      </>
    ),
  },
];

const HOME_FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I know the AI didn’t make things up?',
    a: 'Every note, flashcard and quiz question must carry a word-for-word quote from the lecture transcript. The server checks each quote against the transcript near the timestamp and drops anything it cannot find.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. On the free plan your notes, decks and review schedule stay in your browser on your device.',
  },
  {
    q: 'Do the Exam Pass or Semester Pass renew automatically?',
    a: 'No. The 7-day Exam Pass ($2.99) and the 4-month Semester Pass ($14.99) are one-time payments. Only the Monthly plan renews, and you can cancel it anytime.',
  },
  {
    q: 'Can I study in Arabic, Spanish or Turkish?',
    a: 'Yes. Pick a second language (Arabic, Spanish, French, German, Turkish, Portuguese or Hindi) and each card keeps the original wording with a translation underneath. Arabic renders right-to-left, including in PDF and Anki exports.',
  },
];

export const HomeSectionsBelowTool: React.FC = () => (
  <div className="max-w-6xl mx-auto px-4 sm:px-5 pb-8">
    {/* How it works */}
    <section aria-label="How LearnFromClip works" className="pt-14 sm:pt-20 border-t border-rule">
      <h2 className="max-w-2xl text-3xl sm:text-4xl text-ink leading-tight">
        A lecture goes in. A study pack you can check comes out.
      </h2>
      <ol className="mt-10 grid md:grid-cols-3 gap-x-10 gap-y-8">
        {HOME_STEPS.map((step, idx) => (
          <li key={step.title} className="border-t border-ink pt-4">
            <span className="font-serif text-2xl text-muted">{idx + 1}</span>
            <h3 className="mt-2 text-base font-semibold text-ink">{step.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>

    {/* Accuracy */}
    <section aria-label="Source-linked revision pack preview" className="mt-20 sm:mt-28 grid lg:grid-cols-12 gap-10 items-start">
      <div className="lg:col-span-5">
        <h2 className="text-3xl sm:text-4xl text-ink leading-tight">Every point shows where it came from.</h2>
        <p className="mt-4 text-[15px] sm:text-base leading-relaxed text-muted">
          Each note, card and question carries the lecturer’s exact words and the timestamp they were said at. If we add
          context of our own, it sits in a separate box labelled <strong className="text-ink font-semibold">AI explanation</strong>,
          never mixed into what your lecturer said.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/study"
            className="px-4 py-2.5 rounded-md bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors"
          >
            Open study mode
          </Link>
          <Link
            to="/pricing"
            className="px-4 py-2.5 rounded-md border border-rule bg-surface text-ink text-sm font-semibold hover:border-ink transition-colors"
          >
            See plans
          </Link>
        </div>
      </div>

      <figure className="lg:col-span-7">
        <div className="rounded-lg border border-rule bg-surface p-5 sm:p-7">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-semibold uppercase tracking-[0.12em]">From a pack</span>
            <span className="font-mono text-accent">From lecture · 12:04</span>
          </div>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-ink">
            <strong className="font-semibold">Oxidative phosphorylation</strong> occurs across the inner mitochondrial
            membrane, using the electron transport chain to make ATP.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink/80">
            <span className="quote-mark">
              “Oxidative phosphorylation occurs across the inner mitochondrial membrane via the electron transport chain.”
            </span>
          </p>
          <div className="mt-5 border-l-2 border-[#502EF0] pl-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#502EF0]">AI explanation</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Complexes I–IV establish the proton gradient that drives ATP synthase (Complex V).
            </p>
          </div>
        </div>
      </figure>
    </section>

    {/* Plans */}
    <section aria-label="Student pricing" className="mt-20 sm:mt-28 border-y border-rule py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
      <div>
        <h2 className="text-2xl sm:text-3xl text-ink">Free to start. Exam Pass from $2.99.</h2>
        <p className="mt-1.5 text-[15px] text-muted">
          No account needed on the free plan. Passes are one-time payments and never renew on their own.
        </p>
      </div>
      <Link
        to="/pricing"
        className="shrink-0 self-start sm:self-auto px-4 py-2.5 rounded-md bg-accent text-white text-sm font-semibold hover:bg-accent-dark transition-colors"
      >
        Compare plans
      </Link>
    </section>

    {/* FAQ */}
    <section aria-label="Frequently Asked Questions" className="mt-20 sm:mt-28 grid lg:grid-cols-12 gap-x-10 gap-y-6">
      <h2 className="lg:col-span-4 text-3xl sm:text-4xl text-ink leading-tight">Questions students ask</h2>
      <dl className="lg:col-span-8 border-t border-rule">
        {HOME_FAQ.map((item) => (
          <div key={item.q} className="py-5 border-b border-rule">
            <dt className="text-base font-semibold text-ink">{item.q}</dt>
            <dd className="mt-1.5 text-[15px] leading-relaxed text-muted">{item.a}</dd>
          </div>
        ))}
      </dl>
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
    defaultSecondLanguage: spec.bilingualLanguage,
  };

  return (
    <div>
      <TranscribePage config={customConfig} />
      <HomeSectionsBelowTool />
    </div>
  );
};
