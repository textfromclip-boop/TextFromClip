import React from 'react';
import { Logo } from './Logo';
import { Link, ROUTES, RoutePath } from '../router';

interface NavbarProps {
  current: RoutePath;
}

export const Navbar: React.FC<NavbarProps> = ({ current }) => (
  <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur-md border-b border-rule">
    <div className="max-w-6xl mx-auto px-5 h-18 py-3.5 flex items-center justify-between gap-6">
      <Link to="/youtube" className="shrink-0" aria-label="TextFromClip home">
        <Logo variant="full" size="md" />
      </Link>

      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
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

      <div className="hidden md:flex items-center gap-3 shrink-0">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-muted border border-rule">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          TXT · SRT · VTT
        </span>
      </div>
    </div>
  </header>
);
