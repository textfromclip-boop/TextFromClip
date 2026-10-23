import React, { useState } from 'react';
import { TranscriptResult, ApiResponse } from '../types';
import { TranscriptResultView } from './TranscriptResultView';
import { Link } from '../router';

export interface PlatformConfig {
  name: string;
  heading: string;
  intro: string;
  placeholder: string;
  example?: { label: string; url: string };
  /** Hosts this page expects; used for a friendly client-side check. */
  hosts: string[];
  status: { working: boolean; text: string };
  notes: string[];
}

export const TranscribePage: React.FC<{ config: PlatformConfig }> = ({ config }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptResult | null>(null);

  const run = async (target: string) => {
    const value = target.trim();
    if (!value) return;

    // Catch the most common slip (wrong page) before spending a request.
    try {
      const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
      const looksRight = config.hosts.some((h) => host === h || host.endsWith('.' + h));
      const isMediaFile = /\.(mp4|webm|mp3|wav|m4a|ogg|aac)$/i.test(new URL(value).pathname);
      if (!looksRight && !(config.name === 'YouTube' && isMediaFile)) {
        setError(
          `That link is not from ${config.name}. Use the tab for its platform, or paste a ${config.name} link here.`
        );
        return;
      }
    } catch {
      setError('That does not look like a full link. Include https:// at the start.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data: ApiResponse<TranscriptResult> = await res.json();
      if (!res.ok || !data.success) {
        throw new Error((!data.success && data.error?.message) || 'The transcript could not be created.');
      }
      setResult(data.data);
    } catch (e: any) {
      setError(e?.message || 'Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setUrl('');
  };

  return (
    <div className="max-w-5xl mx-auto px-5 pt-12">
      <h1 className="font-serif text-4xl sm:text-5xl font-semibold leading-[1.1] max-w-2xl">
        {config.heading}
      </h1>
      <p className="mt-4 text-lg text-muted max-w-2xl leading-relaxed">{config.intro}</p>

      <p
        className={`mt-6 max-w-2xl text-sm border-l-4 pl-3 py-1 ${
          config.status.working ? 'border-ink' : 'border-accent'
        }`}
      >
        <strong>{config.status.working ? 'Works now.' : 'Not working right now.'}</strong>{' '}
        {config.status.text}
      </p>

      {!result && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(url);
          }}
          className="mt-8 max-w-2xl"
        >
          <label htmlFor="video-url" className="block text-sm font-semibold mb-2">
            {config.name} link
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="video-url"
              type="url"
              required
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              disabled={loading}
              placeholder={config.placeholder}
              className="flex-1 px-3 py-3 border border-ink bg-surface disabled:opacity-60"
              aria-describedby={error ? 'url-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-6 py-3 bg-accent text-white font-semibold hover:bg-accent-dark disabled:bg-rule disabled:text-muted disabled:cursor-not-allowed"
            >
              {loading ? 'Working…' : 'Get transcript'}
            </button>
          </div>

          {config.example && (
            <p className="mt-3 text-sm text-muted">
              No link handy?{' '}
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setUrl(config.example!.url);
                  run(config.example!.url);
                }}
                className="underline text-accent hover:text-accent-dark"
              >
                {config.example.label}
              </button>
            </p>
          )}

          {error && (
            <p id="url-error" role="alert" className="mt-4 border-l-4 border-accent pl-3 py-1 text-sm">
              {error}
            </p>
          )}
        </form>
      )}

      {result && <TranscriptResultView result={result} onReset={reset} />}

      {!result && (
        <ul className="mt-12 max-w-2xl space-y-2 text-sm text-muted list-disc pl-5">
          {config.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
          <li>
            More on formats, limits and troubleshooting in the <Link to="/guide" className="underline text-accent">guide</Link>.
          </li>
        </ul>
      )}
    </div>
  );
};

