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
  const [aiLeftLabel, setAiLeftLabel] = useState<string>('3 of 3 AI actions left today');
  const [isPaidPlan, setIsPaidPlan] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [current]);

  useEffect(() => {
    let active = true;
    fetch('/api/usage')
      .then((r) => r.json())
      .then((json: any) => {
        if (!active || !json?.success || !json?.data) return;
        const d = json.data;
        const remaining = Math.max(0, Number((d.aiActionsLimit - d.aiActionsUsed).toFixed(1)));
        setIsPaidPlan(d.plan && d.plan !== 'free');
        setAiLeftLabel(`${remaining} of ${d.aiActionsLimit} AI actions left today`);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [current]);

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-md border-b border-rule">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <Link to="/" className="shrink-0" aria-label="LearnFromClip home">
          <div className="sm:hidden">
            <Logo variant="full" size="sm" />
          </div>
          <div className="hidden sm:block">
            <Logo variant="full" size="md" />
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav aria-label="Main" className="hidden md:flex items-center gap-1">
          {ROUTES.map((r) => {
            const active =
              r.path === current ||
              (r.path === '/youtube' && (current === '/' || current === '/app'));
            const isUpload = r.path === '/upload';
            return (
              <Link
                key={r.path}
                to={r.path}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  active
                    ? 'text-accent bg-accent-soft'
                    : isUpload
                    ? 'text-ink bg-slate-100/90 hover:bg-accent-soft hover:text-accent border border-rule/80'
                    : 'text-muted hover:text-ink hover:bg-slate-100/80'
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>

        {/* Remaining Usage Indicator + Upgrade CTA */}
        <div className="hidden lg:flex items-center gap-2.5 shrink-0">
          <span
            title="Free limits reset daily at 00:00 UTC"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-muted border border-rule"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {aiLeftLabel}
          </span>
          {!isPaidPlan && (
            <Link
              to="/pricing"
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] shadow-sm hover:opacity-95 transition-opacity"
            >
              Upgrade
            </Link>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            to="/study"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              current === '/study'
                ? 'bg-accent text-white border-accent'
                : 'bg-accent-soft text-accent border-accent/25'
            }`}
          >
            <span>Study</span>
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

      {/* Mobile Quick Platform Switcher Bar */}
      <div className="md:hidden px-4 pb-2.5">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100/90 border border-rule/80">
          {PLATFORM_TABS.map((tab) => {
            const active =
              current === tab.path ||
              (tab.path === '/youtube' && (current === '/' || current === '/app'));
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

      {/* Mobile Expandable Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden border-t border-rule bg-surface px-4 py-3 space-y-1 shadow-lg"
        >
          <div className="px-3.5 py-2 mb-1 rounded-xl bg-slate-50 border border-rule flex items-center justify-between text-xs">
            <span className="font-semibold text-muted">{aiLeftLabel}</span>
            <Link
              to="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="font-bold text-accent"
            >
              Upgrade →
            </Link>
          </div>
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
