import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { TranscriptResultView } from './components/TranscriptResultView';
import { Features } from './components/Features';
import { HowItWorks } from './components/HowItWorks';
import { SupportedPlatforms } from './components/SupportedPlatforms';
import { Faq } from './components/Faq';
import { SeoPages } from './components/SeoPages';
import { Footer } from './components/Footer';
import { Modals, ModalType } from './components/Modals';
import { TranscriptResult, ApiResponse } from './types';

export const App: React.FC = () => {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('textfromclip-theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult | null>(null);
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  // Sync dark class on document root
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('textfromclip-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('textfromclip-theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark((prev) => !prev);
  };

  const handleNavigate = (sectionId: string) => {
    if (transcriptResult && sectionId !== 'transcript-result') {
      // If result is displayed and user clicked a nav link, smooth scroll to it
    }
    const elem = document.getElementById(sectionId);
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleTranscribe = async (url: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data: ApiResponse<TranscriptResult> = await response.json();

      if (!response.ok || !data.success) {
        const errorText = (!data.success && data.error?.message) || 'Failed to process transcript.';
        throw new Error(errorText);
      }

      setTranscriptResult(data.data);
      // Smooth scroll to results
      setTimeout(() => {
        document.getElementById('transcript-result')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred while transcribing this video.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setTranscriptResult(null);
    setErrorMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Navigation */}
      <Navbar
        isDark={isDark}
        toggleTheme={toggleTheme}
        onNavigate={handleNavigate}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {/* If result is ready, show Transcript Result */}
        {transcriptResult ? (
          <TranscriptResultView
            result={transcriptResult}
            onReset={handleReset}
          />
        ) : (
          /* Otherwise show Hero with Input */
          <Hero
            onTranscribe={handleTranscribe}
            isLoading={isLoading}
            errorMessage={errorMessage}
            clearError={() => setErrorMessage(null)}
          />
        )}

        {/* Feature Highlights */}
        <Features />

        {/* How It Works */}
        <HowItWorks />

        {/* Supported Platforms & Live Status */}
        <SupportedPlatforms />

        {/* SEO Landing Highlights */}
        <SeoPages
          onSelectKeyword={(presetUrl) => {
            if (presetUrl) {
              handleTranscribe(presetUrl);
            } else {
              handleNavigate('hero');
            }
          }}
        />

        {/* FAQ Accordion */}
        <Faq />
      </main>

      {/* Footer */}
      <Footer
        onOpenModal={(modal) => setActiveModal(modal)}
        onNavigate={handleNavigate}
      />

      {/* Policy Modals */}
      <Modals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
      />
    </div>
  );
};
