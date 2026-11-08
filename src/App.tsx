import React, { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { TranscribePage, PlatformConfig } from './components/TranscribePage';
import { GuidePage } from './components/GuidePage';
import { AboutPage } from './components/AboutPage';
import { StudyPage } from './components/StudyPage';
import { PricingPage } from './components/PricingPage';
import { PrivacyPage, TermsPage } from './components/LegalPages';
import {
  HomeSectionsBelowTool,
  SEO_LANDING_PAGES,
  SeoLandingPage,
} from './components/SeoPagesAndHome';
import { useRoute } from './router';
import { checkAndTrackDay7Return, trackEvent } from './utils/analytics';

export const YOUTUBE: PlatformConfig = {
  id: 'youtube',
  route: '/youtube',
  name: 'YouTube',
  eyebrow: 'YouTube Lectures & Study Clips',
  headingPrefix: '2-hour lecture →',
  headingHighlight: '10-minute revision pack.',
  intro:
    'One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.',
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
    title: 'YouTube Lectures & Videos',
    text: 'Works for public YouTube lectures, tutorials, and Shorts. Direct .mp4 and .mp3 lecture links up to 25 MB can also be pasted here.',
  },
  notes: [
    'Accepts youtube.com/watch, youtu.be, /shorts, and /embed links.',
    'Click any "From lecture · MM:SS" badge to jump to that moment in the lecture.',
    'Generate structured notes, flashcards, and a 10-question quiz, or export TXT, SRT, VTT, PDF, Anki CSV, and Markdown.',
  ],
};

const TIKTOK: PlatformConfig = {
  id: 'tiktok',
  route: '/tiktok',
  name: 'TikTok',
  eyebrow: 'TikTok Study & Explainer Clips',
  headingPrefix: '2-hour lecture →',
  headingHighlight: '10-minute revision pack.',
  intro:
    'One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.',
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
    title: 'TikTok Study Clips',
    text: 'Works for public TikTok videos with spoken audio. Private or removed videos cannot be read.',
  },
  notes: [
    'Accepts tiktok.com/@user/video/… and mobile share links (vm.tiktok.com, vt.tiktok.com).',
    'Turn short educational clips into quote-verified notes, flashcards, and quizzes.',
    'Export clean text (.txt), subtitles (.srt, .vtt), PDF, or Anki CSV.',
  ],
};

const INSTAGRAM: PlatformConfig = {
  id: 'instagram',
  route: '/instagram',
  name: 'Instagram',
  eyebrow: 'Instagram Reels',
  headingPrefix: '2-hour lecture →',
  headingHighlight: '10-minute revision pack.',
  intro:
    'One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.',
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
    title: 'Instagram Reel Transcripts & Study Packs',
    text: 'Works for public Instagram Reels visible to logged-out visitors. Transcribes the spoken words from the audio.',
  },
  notes: [
    'Accepts public instagram.com/reel/… links without requiring an account.',
    'Transcribes the spoken words, not the post description.',
    'Every note bullet, flashcard, and quiz question is verified against the spoken transcript.',
  ],
};

const UPLOAD: PlatformConfig = {
  id: 'upload',
  route: '/upload',
  name: 'Upload',
  eyebrow: 'Lecture Audio & Video Recordings',
  headingPrefix: '2-hour lecture →',
  headingHighlight: '10-minute revision pack.',
  intro:
    'One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.',
  placeholder: 'https://example.com/lecture.mp4 (or choose a file above)',
  example: {
    label: 'Choose a lecture recording',
    shortUrl: 'biology_lecture_04.mp4',
    url: '',
    durationLabel: '0:00 / 45:12',
    badgeLabel: 'LECTURE FILE',
    sourceTag: 'Audio',
    clipTitle: 'Uploaded Lecture',
    cues: [
      { time: '00:00', text: 'Select or drag any lecture video or audio recording from your device.' },
      { time: '00:06', text: 'Your spoken words are turned into a timestamped transcript, structured notes, flashcards, and a 10-question quiz.' },
      { time: '00:12', text: 'Tap any "From lecture · 12:04" badge to seek your recording to that exact moment.' },
      { time: '00:18', text: 'Export as PDF, Anki CSV, Markdown, or .txt / .srt / .vtt subtitles.' },
    ],
  },
  hosts: ['.mp4', '.mp3', '.wav', '.m4a', '.mov', '.webm'],
  status: {
    working: true,
    title: 'Lecture Audio & Video Uploads',
    text: 'Works with lecture recordings from your computer or phone. Uploaded audio chunks are deleted from temporary cloud staging as soon as your transcript is ready.',
  },
  notes: [
    'Supports MP4, MOV, WEBM, MKV, MP3, WAV, M4A, OGG, AAC, and FLAC files.',
    'Tapping "From lecture · MM:SS" seeks your uploaded recording to that exact timestamp.',
    'No account needed. On the free plan, your notes stay on your device.',
  ],
};

export const App: React.FC = () => {
  const route = useRoute();

  useEffect(() => {
    checkAndTrackDay7Return();
    if (route === '/pricing') {
      trackEvent('pricing_viewed', '/pricing');
    }
  }, [route]);

  const seoSpec = SEO_LANDING_PAGES[route];

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
        {(route === '/' || route === '/app' || route === '/youtube') && (
          <>
            <TranscribePage key={route} config={YOUTUBE} />
            <HomeSectionsBelowTool />
          </>
        )}
        {route === '/tiktok' && <TranscribePage key="tt" config={TIKTOK} />}
        {route === '/instagram' && <TranscribePage key="ig" config={INSTAGRAM} />}
        {route === '/upload' && <TranscribePage key="up" config={UPLOAD} />}
        {route === '/study' && <StudyPage />}
        {route === '/pricing' && <PricingPage />}
        {route === '/guide' && <GuidePage />}
        {route === '/about' && <AboutPage />}
        {route === '/privacy' && <PrivacyPage />}
        {route === '/terms' && <TermsPage />}
        {seoSpec && <SeoLandingPage key={seoSpec.path} spec={seoSpec} baseConfig={YOUTUBE} />}
      </main>
      <Footer />
    </div>
  );
};
