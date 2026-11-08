import React from 'react';
import { Link } from '../router';
import { Logo } from './Logo';

export const Footer: React.FC = () => (
  <footer className="border-t border-rule bg-surface mt-20">
    <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col gap-6 text-sm text-muted">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
          <Logo variant="full" size="sm" />
          <span className="hidden sm:inline text-slate-300">|</span>
          <p>© {new Date().getFullYear()} LearnFromClip. No account needed. On the free plan, your notes stay on your device.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 sm:gap-x-6 gap-y-2 font-medium">
          <Link to="/app" className="hover:text-accent transition-colors">App</Link>
          <Link to="/study" className="hover:text-accent transition-colors">Study</Link>
          <Link to="/pricing" className="hover:text-accent transition-colors">Pricing</Link>
          <Link to="/upload" className="hover:text-accent transition-colors">Upload</Link>
          <Link to="/guide" className="hover:text-accent transition-colors">Guide</Link>
          <Link to="/privacy" className="hover:text-accent transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-accent transition-colors">Terms</Link>
        </nav>
      </div>

      {/* SEO Tools & Bilingual Study Pack Links */}
      <div className="pt-5 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        <span className="font-bold text-ink">Study Tools:</span>
        <Link to="/youtube-lecture-to-flashcards" className="hover:text-accent">YouTube to Flashcards</Link>
        <Link to="/lecture-to-notes" className="hover:text-accent">Lecture to Notes</Link>
        <Link to="/video-to-quiz" className="hover:text-accent">Video to Quiz</Link>
        <Link to="/youtube-to-text" className="hover:text-accent">YouTube to Text</Link>
        <Link to="/youtube-transcript-to-pdf" className="hover:text-accent">Transcript to PDF</Link>
        <Link to="/flashcards-in-arabic" className="hover:text-accent">Flashcards in Arabic</Link>
        <Link to="/flashcards-in-spanish" className="hover:text-accent">Flashcards in Spanish</Link>
        <Link to="/flashcards-in-french" className="hover:text-accent">Flashcards in French</Link>
        <Link to="/flashcards-in-german" className="hover:text-accent">Flashcards in German</Link>
        <Link to="/flashcards-in-turkish" className="hover:text-accent">Flashcards in Turkish</Link>
        <Link to="/flashcards-in-portuguese" className="hover:text-accent">Flashcards in Portuguese</Link>
        <Link to="/flashcards-in-hindi" className="hover:text-accent">Flashcards in Hindi</Link>
      </div>
    </div>
  </footer>
);
