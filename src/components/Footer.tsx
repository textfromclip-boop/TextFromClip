import React from 'react';
import { Link } from '../router';

export const Footer: React.FC = () => (
  <footer className="border-t border-rule mt-20">
    <div className="max-w-5xl mx-auto px-5 py-8 flex flex-col sm:flex-row justify-between gap-4 text-sm text-muted">
      <p>© {new Date().getFullYear()} TextFromClip. No accounts, no stored transcripts.</p>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
        <Link to="/guide" className="hover:text-accent">Guide</Link>
        <Link to="/about#privacy" className="hover:text-accent">Privacy</Link>
        <Link to="/about#terms" className="hover:text-accent">Terms</Link>
        <Link to="/about#contact" className="hover:text-accent">Contact</Link>
      </nav>
    </div>
  </footer>
);
