import React from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { TranscribePage, PlatformConfig } from './components/TranscribePage';
import { GuidePage } from './components/GuidePage';
import { AboutPage } from './components/AboutPage';
import { useRoute } from './router';

const YOUTUBE: PlatformConfig = {
  id: 'youtube',
  route: '/youtube',
  name: 'YouTube',
  eyebrow: 'YouTube Videos & Shorts · Native Captions + Direct Media AI',
  headingPrefix: 'Turn Video Clips into',
  headingHighlight: 'Text',
  intro:
    'Paste any YouTube video, Short, or direct media link to read, search, and export a timestamped transcript in seconds. No account or installation required.',
  placeholder: 'https://www.youtube.com/watch?v=…',
  example: {
    label: 'Try sample: “Me at the zoo”',
    shortUrl: 'youtube.com/watch?v=jNQXAC9IVRw',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    durationLabel: '0:00 / 0:19',
    badgeLabel: 'YOUTUBE · 16:9',
    sourceTag: 'Captions',
    clipTitle: 'Me at the zoo',
    cues: [
      { time: '00:01', text: 'All right, so here we are in front of the elephants.' },
      {
        time: '00:05',
        text: 'The cool thing about these guys is that they have really, really, really long trunks.',
      },
      { time: '00:12', text: "And that's, that's cool." },
      { time: '00:16', text: "And that's pretty much all there is to say." },
    ],
  },
  hosts: ['youtube.com', 'youtu.be'],
  status: {
    working: true,
    title: 'Native YouTube Caption Tracks',
    text: 'Extracts creator-uploaded subtitles and auto-generated caption tracks directly. Direct .mp4/.mp3 media links up to 25 MB are also transcribed via Whisper AI.',
  },
  notes: [
    'Accepts youtube.com/watch, youtu.be, /shorts, and /embed links.',
    'Click any timestamp in the result to open YouTube at that exact second.',
    'Also accepts direct audio/video files (.mp4, .mp3, .webm) up to 25 MB.',
  ],
};

const TIKTOK: PlatformConfig = {
  id: 'tiktok',
  route: '/tiktok',
  name: 'TikTok',
  eyebrow: 'TikTok Video Clips · Public WebVTT + Whisper AI Fallback',
  headingPrefix: 'Turn TikTok Clips into',
  headingHighlight: 'Text',
  intro:
    'Paste a public TikTok video link to extract its embedded WebVTT or creator caption track with timestamps—with automatic Whisper AI audio fallback.',
  placeholder: 'https://www.tiktok.com/@user/video/…',
  example: {
    label: 'Try a sample TikTok clip',
    shortUrl: 'tiktok.com/@curiousitygeek/video/…',
    url: 'https://www.tiktok.com/@curiousitygeek/video/7649850716713913622',
    durationLabel: '0:00 / 0:58',
    badgeLabel: 'TIKTOK · 9:16',
    sourceTag: 'WebVTT',
    clipTitle: '@curiousitygeek',
    cues: [
      {
        time: '00:00',
        text: 'Reads embedded WebVTT and creator caption tracks directly from public TikTok clips.',
      },
      {
        time: '00:06',
        text: 'Preserves exact utterance timestamps for instant search and subtitle export.',
      },
      {
        time: '00:14',
        text: 'Falls back to Cloudflare Workers AI Whisper when native subtitle tracks are missing.',
      },
    ],
  },
  hosts: ['tiktok.com'],
  status: {
    working: true,
    title: 'WebVTT Captions + Whisper Fallback',
    text: 'Reads public WebVTT and creator_caption tracks first for instant results, and falls back to Workers AI Whisper speech recognition when a clip has no subtitle track.',
  },
  notes: [
    'Accepts tiktok.com/@user/video/… and mobile share links (vm.tiktok.com, vt.tiktok.com).',
    'Exports clean plain text (.txt) or timecoded subtitles (.srt, .vtt).',
    'Never mistakes video descriptions or hashtags for spoken transcript text.',
  ],
};

const INSTAGRAM: PlatformConfig = {
  id: 'instagram',
  route: '/instagram',
  name: 'Instagram',
  eyebrow: 'Instagram Reels · DASH Audio Stream + Whisper Speech-to-Text',
  headingPrefix: 'Turn Instagram Reels into',
  headingHighlight: 'Text',
  intro:
    'Paste a public Instagram Reel link. Because Instagram does not expose caption files, we extract the Reel’s audio stream and run Whisper AI speech recognition.',
  placeholder: 'https://www.instagram.com/reel/…',
  example: {
    label: 'Try sample: NASA Asteroid Reel',
    shortUrl: 'instagram.com/reel/Dd1gQBsCWE8/',
    url: 'https://www.instagram.com/reel/Dd1gQBsCWE8/',
    durationLabel: '0:00 / 0:39',
    badgeLabel: 'REEL · 9:16',
    sourceTag: 'Whisper AI',
    clipTitle: '@nasa · 2024 YR4',
    cues: [
      { time: '00:00', text: 'This asteroid, 2024 YR4, might get interesting.' },
      { time: '00:05', text: 'There was a chance that it could impact Earth.' },
      {
        time: '00:08',
        text: 'The ATLAS Survey, operated by the University of Hawaii, finds about 200 to 250 near-Earth objects per year.',
      },
      { time: '00:25', text: 'As we get more observations, that uncertainty region shrinks.' },
    ],
  },
  hosts: ['instagram.com'],
  status: {
    working: true,
    title: 'Public Reel Audio + Workers AI Whisper',
    text: 'Extracts the lightweight DASH audio track from public Reels and transcribes the spoken words with Cloudflare Workers AI (@cf/openai/whisper).',
  },
  notes: [
    'Accepts public instagram.com/reel/… links without requiring an Instagram login.',
    'Post captions are used only as the title—never as fake transcript text.',
    'Reels with only music or ambient sound are rejected rather than hallucinated.',
  ],
};

export const App: React.FC = () => {
  const route = useRoute();

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-lg focus:border focus:border-accent"
      >
        Skip to content
      </a>
      <Navbar current={route} />
      <main id="main" className="flex-1">
        {route === '/youtube' && <TranscribePage key="yt" config={YOUTUBE} />}
        {route === '/tiktok' && <TranscribePage key="tt" config={TIKTOK} />}
        {route === '/instagram' && <TranscribePage key="ig" config={INSTAGRAM} />}
        {route === '/guide' && <GuidePage />}
        {route === '/about' && <AboutPage />}
      </main>
      <Footer />
    </div>
  );
};
