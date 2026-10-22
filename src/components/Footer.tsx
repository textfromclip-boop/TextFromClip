import React from 'react';
import { Logo } from './Logo';
import { ModalType } from './Modals';

interface FooterProps {
  onOpenModal: (type: ModalType) => void;
  onNavigate: (sectionId: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenModal, onNavigate }) => {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 py-12 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* Logo and Tagline */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Logo variant="full" size="sm" />
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
            <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Turn video clips into text.
            </span>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap items-center justify-center gap-6 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            <button
              onClick={() => onNavigate('platforms')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Supported Platforms
            </button>
            <button
              onClick={() => onOpenModal('privacy')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Privacy Policy
            </button>
            <button
              onClick={() => onOpenModal('terms')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Terms of Service
            </button>
            <button
              onClick={() => onOpenModal('contact')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Contact & Abuse
            </button>
          </nav>

        </div>

        {/* Legal Disclaimer */}
        <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} TextFromClip. All rights reserved.</p>
          <p>
            An account-free video transcription utility powered by Cloudflare Workers.
          </p>
        </div>

      </div>
    </footer>
  );
};
