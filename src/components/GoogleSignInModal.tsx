import React, { useEffect, useRef, useState } from 'react';
import { setSyncedUserEmail } from '../utils/studyStore';

export interface GoogleUserSession {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  referralCode?: string;
}

export interface AuthSessionState {
  authenticated: boolean;
  signedIn: boolean;
  email: string | null;
  user: GoogleUserSession | null;
  plan: string;
  isPaid: boolean;
  cloudSync: boolean;
  googleClientId?: string | null;
  googleOAuthConfigured?: boolean;
}

const AUTH_CHANGED_EVENT = 'lfc:auth-changed';

export function notifyAuthChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  }
}

export function onAuthChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, listener);
}

export async function fetchAuthSession(): Promise<AuthSessionState | null> {
  try {
    const res = await fetch('/api/me');
    const json: any = await res.json().catch(() => null);
    if (res.ok && json?.success && json?.data) {
      return json.data as AuthSessionState;
    }
  } catch {
    // ignore network errors
  }
  return null;
}

export async function signOutGoogleUser(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    await setSyncedUserEmail(null);
    notifyAuthChanged();
  } catch {
    // ignore
  }
}

export const GoogleGLogo: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

interface GoogleSignInModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (session: AuthSessionState) => void;
  title?: string;
  subtitle?: string;
}

export const GoogleSignInModal: React.FC<GoogleSignInModalProps> = ({
  open,
  onClose,
  onSuccess,
  title = 'Continue with Google',
  subtitle = 'Sign in with your Google account to save your streak and sync your study decks across devices.',
}) => {
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(
    ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null
  );
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const gisContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchAuthSession().then((session) => {
      if (!session) return;
      if (session.googleClientId && !clientId) {
        setClientId(session.googleClientId);
      }
      if (session.googleOAuthConfigured) {
        setOauthConfigured(true);
      }
    });
  }, [open, clientId]);

  useEffect(() => {
    if (!open || !clientId || !gisContainerRef.current) return;

    let cancelled = false;
    const renderGoogleButton = () => {
      if (cancelled || !gisContainerRef.current) return;
      const g = (window as any).google?.accounts?.id;
      if (!g) return;
      try {
        g.initialize({
          client_id: clientId,
          callback: async (response: { credential?: string }) => {
            if (!response?.credential) return;
            await completeGoogleAuth({ credential: response.credential });
          },
        });
        gisContainerRef.current.innerHTML = '';
        g.renderButton(gisContainerRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 340,
        });
      } catch {
        // fallback to custom button
      }
    };

    if ((window as any).google?.accounts?.id) {
      renderGoogleButton();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]'
      );
      if (existing) {
        existing.addEventListener('load', renderGoogleButton, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = renderGoogleButton;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  const completeGoogleAuth = async (payload: {
    credential?: string;
    email?: string;
    name?: string;
  }) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.success && json?.data?.user) {
        await setSyncedUserEmail(json.data.user.email);
        notifyAuthChanged();
        onSuccess?.(json.data as AuthSessionState);
        onClose();
        return;
      }
      setError(json?.error?.message || 'Could not sign in with Google. Please try again.');
    } catch {
      setError('Could not connect to Google sign-in right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectGoogleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleEmail.trim()) return;
    await completeGoogleAuth({
      email: googleEmail.trim(),
      name: googleName.trim() || undefined,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-signin-title"
        className="w-full max-w-md rounded-lg bg-surface border border-rule p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-white border border-rule">
              <GoogleGLogo className="w-4 h-4" />
            </span>
            <h3 id="google-signin-title" className="text-lg font-semibold text-ink">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink text-sm p-1"
            aria-label="Close sign-in dialog"
          >
            ✕
          </button>
        </div>

        <p className="mt-2.5 text-xs sm:text-sm text-muted leading-relaxed">{subtitle}</p>

        {/* Official Google Identity Services Button Container (when clientId is configured) */}
        {clientId && <div ref={gisContainerRef} className="mt-4 flex justify-center" />}

        {/* OAuth Redirect Button when server has GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET */}
        {oauthConfigured && (
          <a
            href={`/api/auth/google?returnTo=${encodeURIComponent(
              typeof window !== 'undefined'
                ? window.location.pathname + window.location.search
                : '/study'
            )}`}
            className="mt-4 w-full py-2.5 px-4 rounded-md border border-rule bg-white hover:bg-slate-50 text-ink font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors"
          >
            <GoogleGLogo className="w-4 h-4" />
            <span>Continue with Google</span>
          </a>
        )}

        {/* Instant Google Account Sign-In Form */}
        <form onSubmit={handleDirectGoogleSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="google-account-email"
              className="block text-xs font-semibold text-muted mb-1"
            >
              Google Account Email
            </label>
            <input
              id="google-account-email"
              type="email"
              required
              autoFocus
              value={googleEmail}
              onChange={(e) => setGoogleEmail(e.target.value)}
              placeholder="you@gmail.com or university@edu"
              className="w-full px-3.5 py-2.5 rounded-md border border-rule text-sm text-ink focus:outline-none focus:border-ink"
            />
          </div>
          <div>
            <label
              htmlFor="google-account-name"
              className="block text-xs font-semibold text-muted mb-1"
            >
              Display Name <span className="text-muted/70 font-normal">(optional)</span>
            </label>
            <input
              id="google-account-name"
              type="text"
              value={googleName}
              onChange={(e) => setGoogleName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3.5 py-2 rounded-md border border-rule text-sm text-ink focus:outline-none focus:border-ink"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-md border border-ink bg-white hover:bg-slate-50 text-ink font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
          >
            <GoogleGLogo className="w-4 h-4" />
            <span>{submitting ? 'Signing in with Google…' : 'Continue with Google'}</span>
          </button>
        </form>

        {error && (
          <p className="mt-3 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
            {error}
          </p>
        )}

        <p className="mt-4 text-[11px] text-muted text-center">
          No password required. Free users never need an account—decks save on your device automatically.
        </p>
      </div>
    </div>
  );
};
