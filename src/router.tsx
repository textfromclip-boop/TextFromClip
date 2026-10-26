import React, { useCallback, useEffect, useState } from 'react';

export type RoutePath = '/youtube' | '/tiktok' | '/instagram' | '/upload' | '/guide' | '/about';

export const ROUTES: { path: RoutePath; label: string; title: string }[] = [
  { path: '/youtube', label: 'YouTube', title: 'YouTube Transcript' },
  { path: '/tiktok', label: 'TikTok', title: 'TikTok Transcript' },
  { path: '/instagram', label: 'Instagram', title: 'Instagram Transcript' },
  { path: '/upload', label: 'Upload', title: 'Upload Audio & Video' },
  { path: '/guide', label: 'Guide', title: 'Guide' },
  { path: '/about', label: 'About', title: 'About' },
];

const DEFAULT_PATH: RoutePath = '/youtube';

function normalize(pathname: string): RoutePath {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const found = ROUTES.find((r) => r.path === clean);
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
    // "/" and unknown paths land on the default page; keep the URL honest.
    if (window.location.pathname.replace(/\/+$/, '') !== next) {
      window.history.replaceState({}, '', next + window.location.hash);
    }
    setPath(next);

    const route = ROUTES.find((r) => r.path === next)!;
    document.title = `${route.title} — TextFromClip`;

    // Scroll to the hash target if there is one, otherwise to the top.
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

