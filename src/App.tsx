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
  eyebrow: 'YouTube Videos & Shorts',
  headingPrefix: 'Turn Videos into',
  headingHighlight: 'Text',
  intro:
    'Paste any YouTube video or Short link to read, search, and export a clean timestamped transcript in seconds.',
  placeholder: 'https://www.youtube.com/watch?v=…',
  example: {
    label: 'Try sample: “Me at the zoo”',
    shortUrl: 'youtube.com/watch?v=jNQXAC9IVRw',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    durationLabel: '0:00 / 0:19',
    badgeLabel: 'YOUTUBE',
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
    title: 'YouTube Transcripts',
    text: 'Works for public YouTube videos and Shorts. Direct .mp4 and .mp3 audio/video links up to 25 MB can also be pasted here.',
  },
  notes: [
    'Accepts youtube.com/watch, youtu.be, /shorts, and /embed links.',
    'Click any timestamp in the transcript to jump to that moment on YouTube.',
    'Download as .txt, .srt, or .vtt, or copy directly to your clipboard.',
  ],
};

const TIKTOK: PlatformConfig = {
  id: 'tiktok',
  route: '/tiktok',
  name: 'TikTok',
  eyebrow: 'TikTok Video Clips',
  headingPrefix: 'Turn TikTok Videos into',
  headingHighlight: 'Text',
  intro:
    'Paste a public TikTok video link to get its spoken transcript with timestamps.',
  placeholder: 'https://www.tiktok.com/@name/video/…',
  example: {
    label: 'Try sample: Creator clip',
    shortUrl: 'tiktok.com/@curiousitygeek/video/…',
    url: 'https://www.tiktok.com/@curiousitygeek/video/7649850716713913622',
    durationLabel: '0:00 / 0:58',
    badgeLabel: 'TIKTOK',
    sourceTag: 'Captions',
    clipTitle: 'Creator advice',
    cues: [
      {
        time: '00:00',
        text: 'Every successful project starts with one small experiment.',
      },
      {
        time: '00:05',
        text: 'You do not need to wait until everything feels ready to begin.',
      },
      {
        time: '00:11',
        text: 'Test your ideas in the real world and learn quickly from feedback.',
      },
      {
        time: '00:18',
        text: 'Consistency always beats waiting for the perfect moment.',
      },
    ],
  },
  hosts: ['tiktok.com'],
  status: {
    working: true,
    title: 'TikTok Transcripts',
    text: 'Works for public TikTok videos with spoken audio. Private or removed videos cannot be read.',
  },
  notes: [
    'Accepts tiktok.com/@user/video/… and mobile share links (vm.tiktok.com, vt.tiktok.com).',
    'Export clean text (.txt) or timecoded subtitles (.srt, .vtt).',
    'Videos without spoken words or behind login walls will return a clear notice.',
  ],
};

const INSTAGRAM: PlatformConfig = {
  id: 'instagram',
  route: '/instagram',
  name: 'Instagram',
  eyebrow: 'Instagram Reels',
  headingPrefix: 'Turn Instagram Reels into',
  headingHighlight: 'Text',
  intro:
    'Paste a public Instagram Reel link to get a clean, timestamped transcript of the spoken words.',
  placeholder: 'https://www.instagram.com/reel/…',
  example: {
    label: 'Try sample: NASA Asteroid Reel',
    shortUrl: 'instagram.com/reel/Dd1gQBsCWE8/',
    url: 'https://www.instagram.com/reel/Dd1gQBsCWE8/',
    durationLabel: '0:00 / 0:39',
    badgeLabel: 'INSTAGRAM',
    sourceTag: 'Audio',
    clipTitle: 'Asteroid 2024 YR4',
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
    title: 'Instagram Reel Transcripts',
    text: 'Works for public Instagram Reels visible to logged-out visitors. Transcribes the spoken words from the audio.',
  },
  notes: [
    'Accepts public instagram.com/reel/… links without requiring an account.',
    'Transcribes the spoken words, not the post description.',
    'Reels with only background music, ambient sound, or restricted access cannot be transcribed.',
  ],
};

const UPLOAD: PlatformConfig = {
  id: 'upload',
  route: '/upload',
  name: 'Upload',
  eyebrow: 'Local Audio & Video Files',
  headingPrefix: 'Turn Audio & Video Files into',
  headingHighlight: 'Text',
  intro:
    'Upload any video or audio recording from your computer or phone to read, search, and export a clean timestamped transcript in seconds.',
  placeholder: 'https://example.com/audio-or-video.mp4 (or choose a file above)',
  example: {
    label: 'Choose a video or audio file',
    shortUrl: 'interview_recording.mp4',
    url: '',
    durationLabel: '0:00 / 3:12',
    badgeLabel: 'LOCAL FILE',
    sourceTag: 'Audio',
    clipTitle: 'Uploaded Recording',
    cues: [
      { time: '00:00', text: 'Select or drag any video or audio file up to 200 MB from your device.' },
      { time: '00:06', text: 'Your spoken words are turned into a clean, readable transcript with timestamps.' },
      { time: '00:12', text: 'Uploaded files are automatically removed right after your transcript is ready.' },
      { time: '00:18', text: 'Summarize, rewrite, translate, or download .txt, .srt, and .vtt subtitles.' },
    ],
  },
  hosts: ['.mp4', '.mp3', '.wav', '.m4a', '.mov', '.webm'],
  status: {
    working: true,
    title: 'Audio & Video File Transcripts',
    text: 'Works with video and audio recordings up to 200 MB from your computer or phone. Uploaded files are automatically deleted as soon as your transcript is ready.',
  },
  notes: [
    'Supports MP4, MOV, WEBM, MKV, MP3, WAV, M4A, OGG, AAC, and FLAC files.',
    'Prepares audio automatically on your device so even large videos upload quickly.',
    'Your uploaded files are never kept — they are deleted immediately after transcription.',
  ],
};

export const App: React.FC = () => {
  const route = useRoute();

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink overflow-x-hidden">
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
        {route === '/upload' && <TranscribePage key="up" config={UPLOAD} />}
        {route === '/guide' && <GuidePage />}
        {route === '/about' && <AboutPage />}
      </main>
      <Footer />
    </div>
  );
};
