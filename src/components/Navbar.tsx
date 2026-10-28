import React, { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { Link, ROUTES, RoutePath } from '../router';

interface NavbarProps {
  current: RoutePath;
}

const PLATFORM_TABS: { path: RoutePath; label: string }[] = [
  { path: '/youtube', label: 'YouTube' },
  { path: '/tiktok', label: 'TikTok' },
  { path: '/instagram', label: 'Instagram' },
  { path: '/upload', label: 'Upload' },
];

export const Navbar: React.FC<NavbarProps> = ({ current }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu automatically when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [current]);

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-md border-b border-rule">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <Link to="/youtube" className="shrink-0" aria-label="TextFromClip home">
          <div className="sm:hidden">
            <Logo variant="full" size="sm" />
          </div>
          <div className="hidden sm:block">
            <Logo variant="full" size="md" />
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav aria-label="Main" className="hidden md:flex items-center gap-1.5">
          {ROUTES.map((r) => {
            const active = r.path === current;
            const isUpload = r.path === '/upload';
            return (
              <Link
                key={r.path}
                to={r.path}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  active
                    ? 'text-accent bg-accent-soft'
                    : isUpload
                    ? 'text-ink bg-slate-100/90 hover:bg-accent-soft hover:text-accent border border-rule/80'
                    : 'text-muted hover:text-ink hover:bg-slate-100/80'
                }`}
              >
                {isUpload && (
                  <svg
                    className="w-4 h-4 text-accent shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                )}
                {r.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:flex items-center gap-3 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-muted border border-rule">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            TXT · SRT · VTT
          </span>
        </div>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            to="/upload"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              current === '/upload'
                ? 'bg-accent text-white border-accent'
                : 'bg-accent-soft text-accent border-accent/25'
            }`}
          >
            <svg
              className="w-3.5 h-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <span>Upload</span>
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            className="inline-flex items-center justify-center p-2 rounded-lg text-ink hover:bg-slate-100 border border-rule transition-colors"
          >
            {mobileMenuOpen ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Quick Platform Switcher Bar (Always visible on mobile so switching platforms takes 1 tap) */}
      <div className="md:hidden px-4 pb-2.5">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100/90 border border-rule/80">
          {PLATFORM_TABS.map((tab) => {
            const active = current === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`text-center py-1.5 px-1 rounded-lg text-xs font-bold transition-all truncate ${
                  active
                    ? 'bg-surface text-accent shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Mobile Expandable Drawer for Guide, About & Full Links */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden border-t border-rule bg-surface px-4 py-3 space-y-1 shadow-lg"
        >
          {ROUTES.map((r) => {
            const active = r.path === current;
            return (
              <Link
                key={r.path}
                to={r.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink hover:bg-slate-100'
                }`}
              >
                <span>{r.title}</span>
                <span className="text-xs text-muted">→</span>
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
};
