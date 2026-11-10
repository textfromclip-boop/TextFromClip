import React from 'react';
import { Link } from '../router';

const sections = [
  { id: 'what', title: 'What this is' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'terms', title: 'Terms' },
  { id: 'contact', title: 'Contact' },
];

const H2: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <h2 id={id} className="text-2xl font-bold text-ink mt-12 first:mt-0 scroll-mt-24">
    {children}
  </h2>
);

export const AboutPage: React.FC = () => (
  <div className="max-w-6xl mx-auto px-5 pt-12 pb-6">
    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
      About LearnFromClip
    </div>
    <h1 className="mt-3 text-4xl sm:text-5xl font-medium tracking-tight text-ink leading-[1.1]">
      2-hour lecture →{' '}
      <span>
        10-minute revision pack.
      </span>
    </h1>
    <p className="mt-3 text-lg text-muted max-w-2xl">
      One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.
    </p>

    <div className="mt-10 grid md:grid-cols-[14rem_1fr] gap-10">
      <nav aria-label="On this page" className="md:sticky md:top-24 self-start text-sm">
        <p className="font-bold text-ink mb-2.5">On this page</p>
        <ul className="space-y-1.5 border-l border-rule">
          {sections.map((s) => (
            <li key={s.id}>
              <Link
                to={`/about#${s.id}`}
                className="block pl-3.5 py-1 -ml-px border-l-2 border-transparent text-muted hover:border-accent hover:text-accent font-medium transition-colors"
              >
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 max-w-3xl bg-surface border border-rule rounded-lg p-5 sm:p-8 leading-relaxed space-y-4 text-ink/90 [&_a]:text-accent [&_a]:font-semibold [&_a]:underline">
        <H2 id="what">What this is</H2>
        <p>
          LearnFromClip turns public lectures and educational clips from YouTube, TikTok, Instagram, and local audio/video recordings into a complete revision pack: a searchable timestamped transcript, structured notes, active-recall flashcards, and a 10-question multiple-choice quiz.
        </p>
        <p>
          Every note bullet, flashcard, and quiz question carries a verified word-for-word quote from the lecture transcript and a clickable timestamp so you can jump straight to that moment in the recording. See the <Link to="/guide">guide</Link> for details.
        </p>

        <H2 id="privacy">Privacy</H2>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>No account needed.</strong> On the free plan, your notes, decks, and review history stay on your device (stored locally in your browser).</li>
          <li><strong>Cloud sync for paid plans.</strong> If you choose a paid pass and sign in via email magic link, your study decks sync to our database so you can review across devices.</li>
          <li><strong>Caching & ephemeral uploads.</strong> Uploaded audio chunks are deleted from temporary storage right after transcription. Public lecture transcripts and revision packs may be cached so repeat lookups return faster.</li>
          <li><strong>Fair usage & security.</strong> Requests are protected with cookies, IP checks, and Turnstile to keep the service fast and reliable for students.</li>
        </ul>

        <H2 id="terms">Terms</H2>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong>Fair use.</strong> Designed for personal study, lecture revision, and educational workflows.</li>
          <li><strong>Respect creator & lecturer rights.</strong> Lecture recordings and transcripts belong to their respective creators and institutions.</li>
          <li><strong>Verify critical material.</strong> Automated speech recognition and AI study tools can mishear technical terms; every generated item links to the verbatim lecture quote so you can verify directly.</li>
        </ol>

        <H2 id="contact">Contact</H2>
        <p>Questions, feedback, or bug reports:</p>
        <p className="font-mono text-sm font-semibold text-ink">support@learnfromclip.com</p>
      </article>
    </div>
  </div>
);
