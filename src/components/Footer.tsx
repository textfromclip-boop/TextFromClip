import React from 'react';
import { Link } from '../router';
import { Logo } from './Logo';

export const Footer: React.FC = () => (
  <footer className="border-t border-rule bg-surface mt-20">
    <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-muted">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
        <Logo variant="full" size="sm" />
        <span className="hidden sm:inline text-slate-300">|</span>
        <p>© {new Date().getFullYear()} TextFromClip. Instant transcripts — no accounts, no stored text.</p>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 sm:gap-x-6 gap-y-2 font-medium">
        <Link to="/youtube" className="hover:text-accent transition-colors">YouTube</Link>
        <Link to="/tiktok" className="hover:text-accent transition-colors">TikTok</Link>
        <Link to="/instagram" className="hover:text-accent transition-colors">Instagram</Link>
        <Link to="/upload" className="hover:text-accent transition-colors">Upload</Link>
        <Link to="/guide" className="hover:text-accent transition-colors">Guide</Link>
        <Link to="/about#privacy" className="hover:text-accent transition-colors">Privacy</Link>
        <Link to="/about#terms" className="hover:text-accent transition-colors">Terms</Link>
      </nav>
    </div>
  </footer>
);
