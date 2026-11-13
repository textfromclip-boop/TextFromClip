import React, { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { Link, RoutePath } from '../router';
import {
  fetchAuthSession,
  GoogleGLogo,
  GoogleSignInModal,
  GoogleUserSession,
  onAuthChanged,
  signOutGoogleUser,
} from './GoogleSignInModal';
import { syncDecksWithCloud } from '../utils/studyStore';

interface NavbarProps {
  current: RoutePath;
}

const SOURCE_LINKS: { path: RoutePath; label: string }[] = [
  { path: '/youtube', label: 'YouTube' },
  { path: '/tiktok', label: 'TikTok' },
  { path: '/instagram', label: 'Instagram' },
  { path: '/upload', label: 'Upload' },
];

const PAGE_LINKS: { path: RoutePath; label: string }[] = [
  { path: '/study', label: 'Study' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/guide', label: 'Guide' },
];

export const Navbar: React.FC<NavbarProps> = ({ current }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aiLeftLabel, setAiLeftLabel] = useState<string>('3 of 3 AI actions left today');
  const [isPaidPlan, setIsPaidPlan] = useState(false);
  const [authUser, setAuthUser] = useState<GoogleUserSession | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [current]);

  useEffect(() => {
    let active = true;
    const refreshStatus = () => {
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

      fetchAuthSession()
        .then((session) => {
          if (!active || !session) return;
          setAuthUser(session.user || null);
          if (session.isPaid) setIsPaidPlan(true);
        })
        .catch(() => {});
    };

    refreshStatus();
    const unsub = onAuthChanged(refreshStatus);
    return () => {
      active = false;
      unsub();
    };
  }, [current]);

  const isActive = (path: RoutePath) =>
    path === current || (path === '/youtube' && (current === '/' || current === '/app'));

  const desktopLink = (item: { path: RoutePath; label: string }) => {
    const active = isActive(item.path);
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={`relative py-1.5 text-sm transition-colors ${
          active ? 'text-ink font-semibold' : 'text-muted hover:text-ink font-medium'
        }`}
      >
        {item.label}
        {active && <span aria-hidden="true" className="absolute left-0 right-0 -bottom-[13px] h-0.5 bg-ink" />}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-30 bg-surface border-b border-rule">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-6">
        <div className="flex items-center gap-8 min-w-0">
          <Link to="/" className="shrink-0" aria-label="LearnFromClip home">
            <Logo variant="full" size="sm" />
          </Link>

          <nav aria-label="Main" className="hidden md:flex items-center gap-5">
            {SOURCE_LINKS.map(desktopLink)}
            <span aria-hidden="true" className="h-4 w-px bg-rule" />
            {PAGE_LINKS.map(desktopLink)}
          </nav>
        </div>

        <div className="hidden lg:flex items-center gap-3 shrink-0 text-sm">
          <span title="Free limits reset daily at 00:00 UTC" className="text-muted tabular-nums">
            {aiLeftLabel}
          </span>
          {authUser ? (
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-rule bg-surface text-xs font-medium text-ink">
              <GoogleGLogo className="w-3.5 h-3.5 shrink-0" />
              <span className="max-w-[130px] truncate" title={authUser.email}>
                {authUser.name || authUser.email}
              </span>
              <button
                type="button"
                onClick={() => signOutGoogleUser()}
                className="text-muted hover:text-red-600 font-semibold ml-1"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-rule bg-white hover:border-ink text-ink text-xs font-semibold transition-colors"
            >
              <GoogleGLogo className="w-3.5 h-3.5" />
              <span>Continue with Google</span>
            </button>
          )}
          {!isPaidPlan && (
            <Link
              to="/pricing"
              className="px-3 py-1.5 rounded-md text-sm font-semibold text-ink border border-ink hover:bg-ink hover:text-white transition-colors"
            >
              Upgrade
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle navigation menu"
          className="md:hidden inline-flex items-center justify-center p-2 -mr-2 rounded-md text-ink hover:bg-slate-100 transition-colors"
        >
          {mobileMenuOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile: source switcher as plain tabs */}
      <nav aria-label="Lecture source" className="md:hidden border-t border-rule">
        <div className="max-w-6xl mx-auto px-4 flex gap-5 overflow-x-auto">
          {SOURCE_LINKS.map((tab) => {
            const active = isActive(tab.path);
            return (
              <Link
                key={tab.path}
                to={tab.path}
                aria-current={active ? 'page' : undefined}
                className={`py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${
                  active ? 'border-ink text-ink font-semibold' : 'border-transparent text-muted font-medium'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
          <Link
            to="/study"
            aria-current={current === '/study' ? 'page' : undefined}
            className={`ml-auto py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${
              current === '/study' ? 'border-ink text-ink font-semibold' : 'border-transparent text-accent font-semibold'
            }`}
          >
            Study
          </Link>
        </div>
      </nav>

      {mobileMenuOpen && (
        <nav aria-label="Mobile navigation" className="md:hidden border-t border-rule bg-surface px-4 py-2">
          {[...PAGE_LINKS, { path: '/about' as RoutePath, label: 'About' }].map((r) => (
            <Link
              key={r.path}
              to={r.path}
              onClick={() => setMobileMenuOpen(false)}
              className={`block py-3 text-[15px] border-b border-rule last:border-b-0 ${
                r.path === current ? 'text-ink font-semibold' : 'text-ink/90 font-medium'
              }`}
            >
              {r.label}
            </Link>
          ))}
          <div className="flex items-center justify-between py-3 text-sm border-b border-rule">
            <span className="text-muted">{aiLeftLabel}</span>
            {!isPaidPlan && (
              <Link to="/pricing" onClick={() => setMobileMenuOpen(false)} className="font-semibold text-accent">
                Upgrade
              </Link>
            )}
          </div>
          <div className="py-3">
            {authUser ? (
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-2 font-semibold text-ink truncate">
                  <GoogleGLogo className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{authUser.email}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    signOutGoogleUser();
                    setMobileMenuOpen(false);
                  }}
                  className="text-red-600 font-semibold"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setSignInOpen(true);
                }}
                className="w-full py-2 px-3 rounded-md border border-rule bg-white text-ink text-xs font-semibold flex items-center justify-center gap-2"
              >
                <GoogleGLogo className="w-3.5 h-3.5" />
                <span>Continue with Google</span>
              </button>
            )}
          </div>
        </nav>
      )}

      <GoogleSignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSuccess={async (session) => {
          setAuthUser(session.user);
          if (session.cloudSync) {
            await syncDecksWithCloud();
          }
        }}
      />
    </header>
  );
};
