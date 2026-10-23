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
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent text-xs font-semibold">
      Documentation
    </div>
    <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight text-ink leading-[1.1]">
      Platform & Export{' '}
      <span className="bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] bg-clip-text text-transparent">
        Guide
      </span>
    </h1>
    <p className="mt-3 text-lg text-muted max-w-2xl">
      How TextFromClip extracts transcripts across YouTube, TikTok, Instagram Reels, and direct media files.
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

      <article className="max-w-3xl bg-surface border border-rule rounded-2xl p-6 sm:p-8 shadow-sm leading-relaxed space-y-4 text-ink/90 [&_a]:text-accent [&_a]:font-semibold [&_a]:underline">
        <H2 id="quick-start">Quick start</H2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Select a platform (<Link to="/youtube">YouTube</Link>,{' '}
            <Link to="/tiktok">TikTok</Link> or <Link to="/instagram">Instagram</Link>) or paste any supported URL directly into the bar.
          </li>
          <li>
            Include the full URL starting with <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">https://</code>.
          </li>
          <li>
            Click <strong>Get Transcript</strong>. Caption tracks return in 1–3 seconds; Whisper AI audio transcription takes 5–20 seconds depending on clip length.
          </li>
          <li>
            Copy the full text, search specific words, or download <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.txt</code>, <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.srt</code>, or <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">.vtt</code>.
          </li>
        </ol>

        <H2 id="links">Which links work</H2>
        <div className="overflow-x-auto rounded-xl border border-rule">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left bg-slate-50 border-b border-rule">
                <th className="py-3 px-4 font-bold text-ink">Source</th>
                <th className="py-3 px-4 font-bold text-ink">Engine</th>
                <th className="py-3 px-4 font-bold text-ink">Accepted links</th>
              </tr>
            </thead>
            <tbody className="align-top divide-y divide-rule">
              <tr>
                <td className="py-3 px-4 font-semibold">YouTube</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">Native Captions</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  youtube.com/watch?v=… · youtu.be/… · youtube.com/shorts/… · youtube.com/embed/…
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">TikTok</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">WebVTT + Whisper AI</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  tiktok.com/@user/video/… · vm.tiktok.com/… · vt.tiktok.com/…
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Instagram Reels</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">DASH Audio + Whisper AI</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  instagram.com/reel/… (Public Reels accessible without login)
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Direct Media</td>
                <td className="py-3 px-4 text-emerald-700 font-medium">Whisper AI</td>
                <td className="py-3 px-4 font-mono text-xs text-muted">
                  .mp4 .webm .mp3 .wav .m4a .ogg .aac (up to 25 MB)
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
              HTML5 <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">&lt;track&gt;</code> web subtitle standard.
            </dd>
          </div>
        </dl>

        <H2 id="accuracy">Accuracy</H2>
        <p>
          For YouTube and captioned TikTok clips, we extract the exact subtitle track attached to the video. For Instagram Reels, uncaptioned TikTok clips, and direct media links, we run OpenAI Whisper speech recognition on Cloudflare Workers AI.
        </p>

        <H2 id="troubleshooting">When it fails</H2>
        <dl className="space-y-3">
          <div>
            <dt className="font-bold text-ink">“No clear speech / No captions found”</dt>
            <dd className="text-muted">
              The clip contains only background music, ambient noise, or has no accessible speech track.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">“Unavailable, private, or login-restricted”</dt>
            <dd className="text-muted">
              The creator or platform requires a signed-in account or age verification to view the media.
            </dd>
          </div>
        </dl>
      </article>
    </div>
  </div>
);
