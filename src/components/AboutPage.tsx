import React from 'react';
import { Link } from '../router';

const sections = [
  { id: 'what', title: 'What this is' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'terms', title: 'Terms' },
  { id: 'contact', title: 'Contact' },
];

const H2: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <h2 id={id} className="font-serif text-2xl font-semibold mt-12 first:mt-0 scroll-mt-6">
    {children}
  </h2>
);

export const AboutPage: React.FC = () => (
  <div className="max-w-5xl mx-auto px-5 pt-12">
    <h1 className="font-serif text-4xl sm:text-5xl font-semibold leading-[1.1]">About</h1>
    <p className="mt-4 text-lg text-muted max-w-2xl">
      A small utility that turns a video link into text you can copy, search and download.
    </p>

    <div className="mt-10 grid md:grid-cols-[12rem_1fr] gap-10">
      <nav aria-label="On this page" className="md:sticky md:top-6 self-start text-sm">
        <p className="font-semibold mb-2">On this page</p>
        <ul className="space-y-1.5 border-l border-rule">
          {sections.map((s) => (
            <li key={s.id}>
              <Link to={`/about#${s.id}`} className="block pl-3 -ml-px border-l border-transparent hover:border-accent hover:text-accent">
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="max-w-2xl leading-relaxed space-y-4 [&_a]:text-accent [&_a]:underline">
        <H2 id="what">What this is</H2>
        <p>
          TextFromClip reads the captions a video already has, or, for direct audio and video files, runs speech recognition, and hands you the result as text, SRT or VTT. It runs on Cloudflare Workers. There are no accounts and nothing to install.
        </p>
        <p>
          We say plainly what does not work. YouTube may refuse requests that come from our hosting provider, TikTok clips without captions rely on speech recognition, and Instagram only works for Reels it shows to logged-out visitors. When a source cannot be read, or has no clear speech, you get an error instead of made-up text. See the <Link to="/guide">guide</Link> for the details.
        </p>

        <H2 id="privacy">Privacy</H2>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>No accounts.</strong> We ask for no email, name or password.</li>
          <li><strong>Transcripts are not stored.</strong> The text goes from the platform to your browser. It is not saved in our database.</li>
          <li><strong>Minimal job records.</strong> When the database is enabled we keep a record of provider, video ID, title, length and segment count, deleted after 24 hours, to detect abuse and count usage.</li>
          <li><strong>Rate limiting.</strong> Your IP address is used to enforce the per-minute request limit.</li>
          <li><strong>No ads, no tracking scripts, no sale of data.</strong></li>
          <li>The page loads fonts from Google Fonts, which means your browser contacts Google when it opens.</li>
        </ul>

        <H2 id="terms">Terms</H2>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong>Use it fairly.</strong> It is a free tool for personal, educational and research use. Do not send malicious URLs, flood the service or try to bypass rate limits.</li>
          <li><strong>Respect copyright.</strong> Transcripts come from content made by others. You are responsible for following the copyright and licence terms of the original video. We claim no ownership of the text.</li>
          <li><strong>We do not bypass access controls.</strong> If a platform restricts access, we will not work around logins, DRM or bot protection.</li>
          <li><strong>No warranty.</strong> The service is provided as is. Automatic captions and speech recognition make mistakes, so check anything that matters.</li>
        </ol>

        <H2 id="contact">Contact</H2>
        <p>Questions, feedback or a problem with a specific link:</p>
        <p className="font-mono text-sm">support@textfromclip.com</p>
        <p>Abuse reports and copyright (DMCA) notices:</p>
        <p className="font-mono text-sm">abuse@textfromclip.com</p>
        <p className="text-sm text-muted">We aim to reply within two business days.</p>
      </article>
    </div>
  </div>
);

