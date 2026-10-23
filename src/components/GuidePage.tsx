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
  <h2 id={id} className="font-serif text-2xl font-semibold mt-12 first:mt-0 scroll-mt-6">
    {children}
  </h2>
);

export const GuidePage: React.FC = () => (
  <div className="max-w-5xl mx-auto px-5 pt-12">
    <h1 className="font-serif text-4xl sm:text-5xl font-semibold leading-[1.1]">Guide</h1>
    <p className="mt-4 text-lg text-muted max-w-2xl">
      Everything about using TextFromClip, including what it cannot do.
    </p>

    <div className="mt-10 grid md:grid-cols-[12rem_1fr] gap-10">
      <nav aria-label="On this page" className="md:sticky md:top-6 self-start text-sm">
        <p className="font-semibold mb-2">On this page</p>
        <ul className="space-y-1.5 border-l border-rule">
          {sections.map((s) => (
            <li key={s.id}>
              <Link to={`/guide#${s.id}`} className="block pl-3 -ml-px border-l border-transparent hover:border-accent hover:text-accent">
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="max-w-2xl leading-relaxed space-y-4 [&_a]:text-accent [&_a]:underline">
        <H2 id="quick-start">Quick start</H2>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Open the tab for the platform: <Link to="/youtube">YouTube</Link>, <Link to="/tiktok">TikTok</Link> or <Link to="/instagram">Instagram</Link>.</li>
          <li>Paste the full link, including <code className="font-mono text-sm">https://</code>.</li>
          <li>Press <em>Get transcript</em>. Captions usually come back in a few seconds.</li>
          <li>Copy the text or download it. Search the transcript to find a moment, and click a timestamp to open YouTube at that point.</li>
        </ol>

        <H2 id="links">Which links work</H2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-ink">
                <th className="py-2 pr-4 font-semibold">Source</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 font-semibold">Accepted links</th>
              </tr>
            </thead>
            <tbody className="align-top [&_td]:py-2.5 [&_td]:pr-4 [&_tr]:border-b [&_tr]:border-rule">
              <tr>
                <td>YouTube</td>
                <td>Works</td>
                <td className="font-mono text-xs">youtube.com/watch?v=… · youtu.be/… · youtube.com/shorts/… · youtube.com/embed/…</td>
              </tr>
              <tr>
                <td>Direct files</td>
                <td>Works*</td>
                <td className="font-mono text-xs">.mp4 .webm .mp3 .wav .m4a .ogg .aac, up to 25 MB</td>
              </tr>
              <tr>
                <td>TikTok</td>
                <td>Works (captions)</td>
                <td className="font-mono text-xs">tiktok.com/@user/video/… · vm.tiktok.com/… · vt.tiktok.com/… (clips with public caption tracks)</td>
              </tr>
              <tr>
                <td>Instagram</td>
                <td>Blocked</td>
                <td>Instagram requires a login to read Reels and posts.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          * Direct files are transcribed with speech recognition and need the Workers AI service to be enabled on the server. Paste them on the YouTube tab.
        </p>
        <p>
          We do not work around login walls or bot checks, and we never invent text when a platform refuses access.
        </p>

        <H2 id="formats">Export formats</H2>
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">Copy / .txt</dt>
            <dd className="text-muted">Plain text. With <em>Timestamps</em> ticked, each line starts with <code className="font-mono text-sm">[01:23]</code>; unticked, you get one clean block.</dd>
          </div>
          <div>
            <dt className="font-semibold">.srt</dt>
            <dd className="text-muted">SubRip subtitles with millisecond timecodes. Works in Premiere Pro, Final Cut, DaVinci Resolve and most video players.</dd>
          </div>
          <div>
            <dt className="font-semibold">.vtt</dt>
            <dd className="text-muted">WebVTT subtitles, for the HTML5 <code className="font-mono text-sm">&lt;track&gt;</code> element and web players.</dd>
          </div>
        </dl>

        <H2 id="accuracy">Accuracy</H2>
        <p>
          For YouTube we read the caption track the video already has. If the creator uploaded subtitles, you get exactly their text. If only auto-generated captions exist, you get those, mistakes included, especially with names, jargon and overlapping speakers.
        </p>
        <p>
          For direct files we run Whisper speech recognition. Clear single-speaker audio works well; music, noise and crosstalk do not. Timing on these is only approximate when the model returns no timestamps.
        </p>

        <H2 id="troubleshooting">When it fails</H2>
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold">“No captions or subtitles found”</dt>
            <dd className="text-muted">The video has no caption track at all. There is nothing to read, and we do not guess.</dd>
          </div>
          <div>
            <dt className="font-semibold">“Unavailable or private”</dt>
            <dd className="text-muted">The video is private, deleted, age-restricted or blocked in the server’s region. Unlisted videos usually work.</dd>
          </div>
          <div>
            <dt className="font-semibold">“Too many requests”</dt>
            <dd className="text-muted">There is a per-IP limit. Wait for the number of seconds shown and try again.</dd>
          </div>
          <div>
            <dt className="font-semibold">“That link is not from …”</dt>
            <dd className="text-muted">You pasted a link on the wrong tab. Switch tabs and paste again.</dd>
          </div>
        </dl>
        <p>
          Still stuck? <Link to="/about#contact">Contact us</Link> with the link you tried and the message you saw.
        </p>
      </article>
    </div>
  </div>
);

