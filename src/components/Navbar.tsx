import React from 'react';
import { Logo } from './Logo';
import { Link, ROUTES, RoutePath } from '../router';

interface NavbarProps {
  current: RoutePath;
}

export const Navbar: React.FC<NavbarProps> = ({ current }) => (
  <header className="border-b border-rule">
    <div className="max-w-5xl mx-auto px-5 flex flex-col sm:flex-row sm:items-end justify-between gap-x-10">
      <Link to="/youtube" className="self-start py-4 sm:pb-3" aria-label="TextFromClip home">
        <Logo variant="full" size="md" />
      </Link>

      <nav aria-label="Main" className="-mb-px flex gap-7 overflow-x-auto">
        {ROUTES.map((r) => {
          const active = r.path === current;
          return (
            <Link
              key={r.path}
              to={r.path}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap pb-3 pt-1 text-[15px] border-b-2 ${
                active
                  ? 'text-accent border-accent'
                  : 'text-ink border-transparent hover:text-accent'
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </nav>
    </div>
  </header>
);
