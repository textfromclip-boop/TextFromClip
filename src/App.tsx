import React from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { TranscribePage, PlatformConfig } from './components/TranscribePage';
import { GuidePage } from './components/GuidePage';
import { AboutPage } from './components/AboutPage';
import { useRoute } from './router';

const YOUTUBE: PlatformConfig = {
  name: 'YouTube',
  heading: 'Get the transcript of any YouTube video.',
  intro:
    'Paste a link and read, search and download what is said, with timestamps. Regular videos and Shorts both work.',
  placeholder: 'https://www.youtube.com/watch?v=…',
  example: {
    label: 'Try it on “Me at the zoo”',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  },
  hosts: ['youtube.com', 'youtu.be'],
  status: {
    working: true,
    text: 'Reads the video’s own captions. If a video has none, you will be told rather than given guesses. Direct .mp4/.mp3 links can also be pasted here.',
  },
  notes: [
    'Accepted: youtube.com/watch, youtu.be, /shorts and /embed links.',
    'Download as .txt, .srt or .vtt, or copy to the clipboard.',
    'Click any timestamp to open YouTube at that moment.',
  ],
};

const TIKTOK: PlatformConfig = {
  name: 'TikTok',
  heading: 'TikTok transcripts.',
  intro:
    'Paste a public TikTok video link to read, search and download its caption track with timestamps.',
  placeholder: 'https://www.tiktok.com/@name/video/…',
  example: {
    label: 'Try it on a spoken TikTok clip',
    url: 'https://www.tiktok.com/@curiousitygeek/video/7649850716713913622',
  },
  hosts: ['tiktok.com'],
  status: {
    working: true,
    text: 'Reads public WebVTT and creator caption tracks when TikTok includes them on the video page. Clips without captions or behind a bot check fail rather than return guesses.',
  },
  notes: [
    'Accepted: tiktok.com/@user/video/… and mobile share links (vm.tiktok.com, vt.tiktok.com).',
    'Download as .txt, .srt or .vtt, or copy to the clipboard.',
    'If a clip has no caption track attached, you will get an explicit error rather than made-up text.',
  ],
};

const INSTAGRAM: PlatformConfig = {
  name: 'Instagram',
  heading: 'Instagram Reels transcripts.',
  intro:
    'Paste a public Reel link. Instagram Reels have no caption track, so we listen to the Reel’s audio and write out what is said, with timestamps.',
  placeholder: 'https://www.instagram.com/reel/…',
  example: {
    label: 'Try it on a public Reel',
    url: 'https://www.instagram.com/reel/Dd1gQBsCWE8/',
  },
  hosts: ['instagram.com'],
  status: {
    working: true,
    text: 'Works for public Reels that Instagram shows to visitors who are not logged in. This is speech recognition, so expect occasional mistakes with names and jargon. Private or login-only Reels, and Reels with only music or sound, return an error instead of guesses.',
  },
  notes: [
    'Accepted: instagram.com/reel/… links. We never ask for your Instagram login.',
    'The post description is only used as the title. The transcript comes from the audio.',
    'A 2-minute Reel takes roughly 15 to 20 seconds.',
  ],
};

export const App: React.FC = () => {
  const route = useRoute();

  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-surface focus:px-3 focus:py-2 focus:border focus:border-ink"
      >
        Skip to content
      </a>
      <Navbar current={route} />
      <main id="main" className="flex-1">
        {/* key forces fresh state (input, result, errors) when switching tabs */}
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
