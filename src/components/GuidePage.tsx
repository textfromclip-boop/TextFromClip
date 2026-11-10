import React from 'react';
import { Link } from '../router';

const sections = [
  { id: 'quick-start', title: 'Quick start' },
  { id: 'links', title: 'Which links work' },
  { id: 'formats', title: 'Export formats' },
  { id: 'accuracy', title: 'Accuracy' },
  { id: 'troubleshooting', title: 'When it fails' },
];

const H2: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <h2 id={id} className="text-2xl font-bold text-ink mt-12 first:mt-0 scroll-mt-24">
    {children}
  </h2>
);

export const GuidePage: React.FC = () => (
  <div className="max-w-6xl mx-auto px-5 pt-12 pb-6">
    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
      Help & Documentation
    </div>
    <h1 className="mt-3 text-4xl sm:text-5xl font-medium tracking-tight text-ink leading-[1.1]">
      Platform & Export{' '}
      <span>
        Guide
      </span>
    </h1>
    <p className="mt-3 text-lg text-muted max-w-2xl">
      Everything you need to know about turning lectures into revision packs, transcripts, flashcards, and quizzes with LearnFromClip.
    </p>

    <div className="mt-10 grid md:grid-cols-[14rem_1fr] gap-10">
      <nav aria-label="On this page" className="md:sticky md:top-24 self-start text-sm">
        <p className="font-bold text-ink mb-2.5">On this page</p>
        <ul className="space-y-1.5 border-l border-rule">
          {sections.map((s) => (
            <li key={s.id}>
              <Link
                to={`/guide#${s.id}`}
                className="block pl-3.5 py-1 -ml-px border-l-2 border-transparent text-muted hover:border-accent hover:text-accent font-medium transition-colors"
              >
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 max-w-3xl bg-surface border border-rule rounded-lg p-5 sm:p-8 leading-relaxed space-y-4 text-ink/90 [&_a]:text-accent [&_a]:font-semibold [&_a]:underline">
        <H2 id="quick-start">Quick start</H2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Open the tab for your video’s platform: <Link to="/youtube">YouTube</Link>,{' '}
            <Link to="/tiktok">TikTok</Link>, <Link to="/instagram">Instagram</Link>, or{' '}
            <Link to="/upload">Upload</Link>.
          </li>
          <li>
            Paste the full video link starting with <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">https://</code>, or choose a video/audio file from your device.
          </li>
          <li>
            Click <strong>Get Transcript</strong>. Transcripts typically return in a few seconds.
          </li>
          <li>
            Read or search the text, copy it with or without timestamps, or download <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.txt</code>, <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.srt</code>, or <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.vtt</code>.
          </li>
        </ol>

        <H2 id="links">Which links work</H2>
        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left bg-slate-50 border-b border-rule">
                <th className="py-3 px-4 font-bold text-ink">Source</th>
                <th className="py-3 px-4 font-bold text-ink">Status</th>
                <th className="py-3 px-4 font-bold text-ink">Accepted links</th>
              </tr>
            </thead>
            <tbody className="align-top divide-y divide-rule">
              <tr>
                <td className="py-3 px-4 font-semibold">YouTube</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">Supported</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  youtube.com/watch?v=… · youtu.be/… · youtube.com/shorts/… · youtube.com/embed/…
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">TikTok</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">Supported</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  tiktok.com/@user/video/… · vm.tiktok.com/… · vt.tiktok.com/…
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Instagram Reels</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">Supported</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  instagram.com/reel/… (Public Reels accessible without login)
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Local File Upload</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">Supported</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  .mp4 .mov .webm .mkv .mp3 .wav .m4a .ogg .aac .flac (up to 200 MB)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          We never fabricate transcripts or substitute post descriptions for spoken words.
        </p>

        <H2 id="formats">Export formats</H2>
        <dl className="space-y-3">
          <div>
            <dt className="font-bold text-ink">Copy / .TXT</dt>
            <dd className="text-muted">
              Plain text. With <em>Timestamps</em> enabled, each segment starts with{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">[01:23]</code>;
              unchecked, you get a clean continuous paragraph.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">.SRT (SubRip)</dt>
            <dd className="text-muted">
              Standard subtitle format with millisecond timecodes for Premiere Pro, Final Cut Pro, DaVinci Resolve, and CapCut.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">.VTT (WebVTT)</dt>
            <dd className="text-muted">
              Standard web subtitle format compatible with HTML5 video players and online tools.
            </dd>
          </div>
        </dl>

        <H2 id="accuracy">Accuracy</H2>
        <p>
          Transcripts reflect the actual spoken words in the video. Clear single-speaker audio provides the highest accuracy. Videos with loud background music, sound effects, overlapping speakers, or heavy accents may contain occasional misheard words.
        </p>

        <H2 id="troubleshooting">When it fails</H2>
        <dl className="space-y-3">
          <div>
            <dt className="font-bold text-ink">“No clear speech found”</dt>
            <dd className="text-muted">
              The video contains only music, ambient noise, or sound effects without clear spoken words.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">“Unavailable, private, or login-restricted”</dt>
            <dd className="text-muted">
              The video is private, removed, age-restricted, or requires an account login to view.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">“That link is from ...”</dt>
            <dd className="text-muted">
              You submitted a link on the wrong platform tab. Switch to the tab matching your video link.
            </dd>
          </div>
        </dl>
      </article>
    </div>
  </div>
);
