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
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent text-xs font-semibold">
      About TextFromClip
    </div>
    <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight text-ink leading-[1.1]">
      Built for Fast, Honest{' '}
      <span className="bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] bg-clip-text text-transparent">
        Transcription
      </span>
    </h1>
    <p className="mt-3 text-lg text-muted max-w-2xl">
      A focused edge utility that turns public video clips into searchable, timecoded text.
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

      <article className="min-w-0 max-w-3xl bg-surface border border-rule rounded-2xl p-5 sm:p-8 shadow-sm leading-relaxed space-y-4 text-ink/90 [&_a]:text-accent [&_a]:font-semibold [&_a]:underline">
        <H2 id="what">What this is</H2>
        <p>
          TextFromClip converts public video and audio clips from YouTube, TikTok, and Instagram into clean, searchable, timestamped text. Results can be searched directly in your browser or downloaded as <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.txt</code>, <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.srt</code>, or <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.vtt</code> files.
        </p>
        <p>
          When a video is private, login-gated, or contains no clear speech, TextFromClip reports the exact reason instead of returning fabricated text. See the <Link to="/guide">guide</Link> for details.
        </p>

        <H2 id="privacy">Privacy</H2>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>No accounts required.</strong> We never ask for your email, password, or social media login.</li>
          <li><strong>No permanent transcript storage.</strong> Short-lived edge caching is used solely to speed up repeat lookups and is automatically purged.</li>
          <li><strong>Rate limiting.</strong> Requests are rate-limited per IP to keep the service fast and available.</li>
          <li><strong>Zero ad trackers.</strong> We do not sell user data or run third-party ad networks.</li>
        </ul>

        <H2 id="terms">Terms</H2>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong>Fair use.</strong> Designed for personal, educational, creator, and research workflows.</li>
          <li><strong>Respect creator rights.</strong> Transcripts belong to the original creators of the underlying media.</li>
          <li><strong>No warranty.</strong> Automated captions and speech recognition can mishear names or technical terms; always verify critical quotes.</li>
        </ol>

        <H2 id="contact">Contact</H2>
        <p>Questions, feedback, or bug reports:</p>
        <p className="font-mono text-sm font-semibold text-ink">support@textfromclip.com</p>
      </article>
    </div>
  </div>
);
