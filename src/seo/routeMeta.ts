// Single source of truth for per-route <title>, meta description and canonical URL.
// Used by the client router (on navigation) and by scripts/build-pages.mjs, which writes a
// static HTML file per route so crawlers and link previews see the right tags on direct load.

export const SITE_ORIGIN = 'https://learnfromclip.com';

export interface RouteMeta {
  title: string;
  description: string;
  /** Canonical path (defaults to the route itself). */
  canonical?: string;
}

const SUB = 'One upload. Transcript, notes, flashcards and quiz, every point linked to the lecture.';

export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: 'LearnFromClip — 2-hour lecture → 10-minute revision pack.',
    description: `${SUB} No account needed. On the free plan, your notes stay on your device.`,
  },
  '/app': {
    title: 'Lecture to Revision Pack Tool — LearnFromClip',
    description: 'Paste a lecture link or upload a recording to get a timestamped transcript, structured notes, flashcards and a 10-question quiz.',
    canonical: '/',
  },
  '/youtube': {
    title: 'YouTube Lecture to Revision Pack — LearnFromClip',
    description: 'Turn any public YouTube lecture into a timestamped transcript, quote-verified notes, flashcards and a 10-question quiz.',
  },
  '/tiktok': {
    title: 'TikTok Study Clip to Notes & Flashcards — LearnFromClip',
    description: 'Transcribe public TikTok study and explainer clips and turn them into quote-verified notes, flashcards and quizzes.',
  },
  '/instagram': {
    title: 'Instagram Reel Transcript & Study Pack — LearnFromClip',
    description: 'Transcribe the spoken words of public Instagram Reels and build notes, flashcards and a quiz from them.',
  },
  '/upload': {
    title: 'Upload a Lecture Recording — LearnFromClip',
    description: 'Upload a lecture video or audio file (MP4, MP3, WAV, M4A…) and get a transcript, notes, flashcards and a quiz linked to the recording.',
  },
  '/study': {
    title: 'Today’s Study Schedule & Decks — LearnFromClip',
    description: 'Review your due flashcards with spaced repetition (SM-2), keep your daily streak and retake quizzes from your lectures.',
  },
  '/pricing': {
    title: 'Plans & Student Passes — LearnFromClip',
    description: 'Free plan with no sign-up. Exam Pass $2.99 for 7 days, Monthly $4.99, Semester Pass $14.99. Passes never auto-renew. Regional student pricing.',
  },
  '/guide': {
    title: 'How to Use LearnFromClip — Guide',
    description: 'Step-by-step guide: paste a lecture link or upload a recording, make a revision pack, study with spaced repetition and export to PDF or Anki.',
  },
  '/about': {
    title: 'About LearnFromClip',
    description: 'LearnFromClip turns long lectures into short, source-linked revision packs for university and high-school students.',
  },
  '/privacy': {
    title: 'Privacy Policy — LearnFromClip',
    description: 'What LearnFromClip stores: free decks stay on your device; paid decks are synced to our cloud; uploads are deleted after transcription.',
  },
  '/terms': {
    title: 'Terms of Service & Refund Policy — LearnFromClip',
    description: 'Terms of use, plans, refund policy and fair-use limits for LearnFromClip.',
  },
  '/youtube-lecture-to-flashcards': {
    title: 'YouTube Lecture to Flashcards (Free, Quote-Verified) — LearnFromClip',
    description: 'Paste a YouTube lecture link and get up to 30 free flashcards, each linked to the exact moment in the lecture. Export to Anki.',
  },
  '/lecture-to-notes': {
    title: 'Lecture to Structured Notes — LearnFromClip',
    description: 'Turn a lecture recording or YouTube link into organised notes with key definitions and verbatim quotes linked to timestamps.',
  },
  '/video-to-quiz': {
    title: 'Video to Multiple-Choice Quiz — LearnFromClip',
    description: 'Generate a 10-question multiple-choice quiz from any lecture video, with explanations and a link to where each answer was said.',
  },
  '/youtube-to-text': {
    title: 'YouTube to Text Transcript (TXT, SRT, VTT) — LearnFromClip',
    description: 'Free YouTube transcript generator: read, search, edit and export a clean timestamped transcript as TXT, SRT or VTT.',
  },
  '/youtube-transcript-to-pdf': {
    title: 'YouTube Transcript to PDF Study Pack — LearnFromClip',
    description: 'Convert a YouTube lecture into a printable PDF with structured notes, flashcards and a 10-question practice quiz.',
  },
  '/flashcards-in-arabic': {
    title: 'Lecture Flashcards with Arabic Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards: the original text with a right-to-left Arabic translation under every card, plus RTL-safe PDF and Anki export.',
  },
  '/flashcards-in-spanish': {
    title: 'Lecture Flashcards with Spanish Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards with a Spanish translation under every card, each linked to the moment in the lecture.',
  },
  '/flashcards-in-french': {
    title: 'Lecture Flashcards with French Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards with a French translation under every card, each linked to the moment in the lecture.',
  },
  '/flashcards-in-german': {
    title: 'Lecture Flashcards with German Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards with a German translation under every card, each linked to the moment in the lecture.',
  },
  '/flashcards-in-turkish': {
    title: 'Lecture Flashcards with Turkish Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards with a Turkish translation under every card, each linked to the moment in the lecture.',
  },
  '/flashcards-in-portuguese': {
    title: 'Lecture Flashcards with Portuguese Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards with a Portuguese translation under every card, each linked to the moment in the lecture.',
  },
  '/flashcards-in-hindi': {
    title: 'Lecture Flashcards with Hindi Translation — LearnFromClip',
    description: 'Bilingual lecture flashcards with a Hindi translation under every card, each linked to the moment in the lecture.',
  },
};

export function canonicalUrlFor(path: string): string {
  const meta = ROUTE_META[path];
  const canonicalPath = meta?.canonical || path;
  return `${SITE_ORIGIN}${canonicalPath === '/' ? '/' : canonicalPath}`;
}

/** Updates <title>, meta description, canonical and og tags in the live document (client side). */
export function applyRouteMeta(path: string): void {
  if (typeof document === 'undefined') return;
  const meta = ROUTE_META[path] || ROUTE_META['/'];
  document.title = meta.title;
  const set = (selector: string, attr: string, value: string, create: () => HTMLElement) => {
    let el = document.head.querySelector(selector) as HTMLElement | null;
    if (!el) {
      el = create();
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  };
  const metaTag = (name: string, isProperty = false) => () => {
    const m = document.createElement('meta');
    m.setAttribute(isProperty ? 'property' : 'name', name);
    return m;
  };
  set('meta[name="description"]', 'content', meta.description, metaTag('description'));
  set('meta[property="og:title"]', 'content', meta.title, metaTag('og:title', true));
  set('meta[property="og:description"]', 'content', meta.description, metaTag('og:description', true));
  set('meta[property="og:url"]', 'content', canonicalUrlFor(path), metaTag('og:url', true));
  set('link[rel="canonical"]', 'href', canonicalUrlFor(path), () => {
    const l = document.createElement('link');
    l.setAttribute('rel', 'canonical');
    return l;
  });
}
