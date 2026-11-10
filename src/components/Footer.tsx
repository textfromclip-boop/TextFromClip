import React from 'react';
import { Link } from '../router';
import { Logo } from './Logo';

const COLUMNS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { to: '/app', label: 'Make a revision pack' },
      { to: '/upload', label: 'Upload a recording' },
      { to: '/study', label: 'Study' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/guide', label: 'Guide' },
    ],
  },
  {
    heading: 'Tools',
    links: [
      { to: '/youtube-lecture-to-flashcards', label: 'YouTube to flashcards' },
      { to: '/lecture-to-notes', label: 'Lecture to notes' },
      { to: '/video-to-quiz', label: 'Video to quiz' },
      { to: '/youtube-to-text', label: 'YouTube to text' },
      { to: '/youtube-transcript-to-pdf', label: 'Transcript to PDF' },
    ],
  },
  {
    heading: 'Bilingual flashcards',
    links: [
      { to: '/flashcards-in-arabic', label: 'Arabic' },
      { to: '/flashcards-in-spanish', label: 'Spanish' },
      { to: '/flashcards-in-french', label: 'French' },
      { to: '/flashcards-in-german', label: 'German' },
      { to: '/flashcards-in-turkish', label: 'Turkish' },
      { to: '/flashcards-in-portuguese', label: 'Portuguese' },
      { to: '/flashcards-in-hindi', label: 'Hindi' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { to: '/about', label: 'About' },
      { to: '/privacy', label: 'Privacy' },
      { to: '/terms', label: 'Terms' },
      { to: '/refund', label: 'Refund policy' },
    ],
  },
];

export const Footer: React.FC = () => (
  <footer className="border-t border-rule bg-surface mt-24">
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-12">
      <div className="grid grid-cols-2 md:grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-2 md:col-span-4">
          <Logo variant="full" size="sm" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
            No account needed. On the free plan, your notes stay on your device.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.heading} aria-label={col.heading} className="md:col-span-2">
            <p className="text-sm font-semibold text-ink">{col.heading}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-muted hover:text-ink transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="mt-12 pt-6 border-t border-rule text-xs text-muted">
        © {new Date().getFullYear()} LearnFromClip
      </p>
    </div>
  </footer>
);
