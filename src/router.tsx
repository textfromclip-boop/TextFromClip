import React, { useCallback, useEffect, useState } from 'react';

export type RoutePath =
  | '/'
  | '/app'
  | '/study'
  | '/pricing'
  | '/privacy'
  | '/terms'
  | '/youtube'
  | '/tiktok'
  | '/instagram'
  | '/upload'
  | '/guide'
  | '/about'
  | '/youtube-lecture-to-flashcards'
  | '/lecture-to-notes'
  | '/video-to-quiz'
  | '/youtube-to-text'
  | '/youtube-transcript-to-pdf'
  | '/flashcards-in-arabic'
  | '/flashcards-in-spanish'
  | '/flashcards-in-french'
  | '/flashcards-in-german'
  | '/flashcards-in-turkish'
  | '/flashcards-in-portuguese'
  | '/flashcards-in-hindi';

export const ROUTES: { path: RoutePath; label: string; title: string }[] = [
  { path: '/youtube', label: 'YouTube', title: 'YouTube Lecture to Revision Pack' },
  { path: '/tiktok', label: 'TikTok', title: 'TikTok Study Pack' },
  { path: '/instagram', label: 'Instagram', title: 'Instagram Reel Transcript' },
  { path: '/upload', label: 'Upload', title: 'Upload Lecture Audio & Video' },
  { path: '/study', label: 'Study', title: 'Today’s Study Schedule & Decks' },
  { path: '/pricing', label: 'Pricing', title: 'Plans & Student Passes' },
  { path: '/guide', label: 'Guide', title: 'Guide' },
];

export const ALL_KNOWN_ROUTES: { path: RoutePath; title: string }[] = [
  { path: '/', title: '2-hour lecture → 10-minute revision pack.' },
  { path: '/app', title: 'Lecture to Revision Pack Tool' },
  ...ROUTES,
  { path: '/about', title: 'About' },
  { path: '/privacy', title: 'Privacy Policy' },
  { path: '/terms', title: 'Terms of Service' },
  { path: '/youtube-lecture-to-flashcards', title: 'YouTube Lecture to Flashcards' },
  { path: '/lecture-to-notes', title: 'Lecture to Structured Notes' },
  { path: '/video-to-quiz', title: 'Video to Multiple-Choice Quiz' },
  { path: '/youtube-to-text', title: 'YouTube to Text Transcript' },
  { path: '/youtube-transcript-to-pdf', title: 'YouTube Transcript to PDF' },
  { path: '/flashcards-in-arabic', title: 'Lecture Flashcards in Arabic' },
  { path: '/flashcards-in-spanish', title: 'Lecture Flashcards in Spanish' },
  { path: '/flashcards-in-french', title: 'Lecture Flashcards in French' },
  { path: '/flashcards-in-german', title: 'Lecture Flashcards in German' },
  { path: '/flashcards-in-turkish', title: 'Lecture Flashcards in Turkish' },
  { path: '/flashcards-in-portuguese', title: 'Lecture Flashcards in Portuguese' },
  { path: '/flashcards-in-hindi', title: 'Lecture Flashcards in Hindi' },
];

const DEFAULT_PATH: RoutePath = '/';

function normalize(pathname: string): RoutePath {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const found = ALL_KNOWN_ROUTES.find((r) => r.path === clean);
  return found ? found.path : DEFAULT_PATH;
}

/** Navigate without a full page load. Accepts "/about#privacy" style targets. */
export function navigate(to: string) {
  if (typeof window === 'undefined') return;
  const current = window.location.pathname + window.location.hash;
  if (to !== current) {
    window.history.pushState({}, '', to);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): RoutePath {
  const [path, setPath] = useState<RoutePath>(() => normalize(window.location.pathname));

  const sync = useCallback(() => {
    const next = normalize(window.location.pathname);
    if ((window.location.pathname.replace(/\/+$/, '') || '/') !== next) {
      window.history.replaceState({}, '', next + window.location.hash);
    }
    setPath(next);

    const route = ALL_KNOWN_ROUTES.find((r) => r.path === next);
    document.title = route
      ? `${route.title} — LearnFromClip`
      : 'LearnFromClip — 2-hour lecture → 10-minute revision pack.';

    requestAnimationFrame(() => {
      const id = window.location.hash.slice(1);
      const el = id ? document.getElementById(id) : null;
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [sync]);

  return path;
}

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

/** Real <a href> so middle-click / copy-link / crawlers work; plain clicks stay in-app. */
export const Link: React.FC<LinkProps> = ({ to, onClick, children, ...rest }) => (
  <a
    href={to}
    onClick={(e) => {
      onClick?.(e);
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        rest.target === '_blank'
      ) {
        return;
      }
      e.preventDefault();
      navigate(to);
    }}
    {...rest}
  >
    {children}
  </a>
);
