import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        params: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: (error: any) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  className?: string;
}

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({ onToken, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let mounted = true;

    const renderWidget = () => {
      if (!mounted || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
      }

      try {
        const id = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'compact',
          callback: (token: string) => {
            if (mounted) onToken(token);
          },
          'expired-callback': () => {
            if (mounted) onToken('');
          },
          'error-callback': () => {
            if (mounted) onToken('');
          },
        });
        widgetIdRef.current = id;
      } catch {
        // Turnstile fallback for environments where script fails
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existingScript = document.querySelector('script[src*="turnstile/v0/api.js"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (mounted) renderWidget();
        };
        document.head.appendChild(script);
      } else {
        const timer = setInterval(() => {
          if (window.turnstile) {
            clearInterval(timer);
            if (mounted) renderWidget();
          }
        }, 150);
        return () => {
          mounted = false;
          clearInterval(timer);
        };
      }
    }

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
    };
  }, [siteKey, onToken]);

  if (!siteKey) {
    return null;
  }

  return (
    <div className={`turnstile-container flex justify-center py-2 ${className}`}>
      <div ref={containerRef} />
    </div>
  );
};
