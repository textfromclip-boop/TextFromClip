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

      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
        {ROUTES.map((r) => {
          const active = r.path === current;
          return (
            <Link
              key={r.path}
              to={r.path}
              aria-current={active ? 'page' : undefined}
              className={`relative whitespace-nowrap px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                active
                  ? 'text-accent bg-accent-soft'
                  : 'text-muted hover:text-ink hover:bg-slate-100/80'
              }`}
            >
              {r.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-[15px] h-0.5 bg-gradient-to-r from-[#0F8CFA] via-[#2868F7] to-[#5131ED] rounded-full" />
              )}
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
