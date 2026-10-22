import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

export const Faq: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const faqs: FaqItem[] = [
    {
      question: 'How does TextFromClip work?',
      answer:
        'TextFromClip uses a provider-adapter architecture deployed on Cloudflare edge workers. When you paste a video URL, our system first queries for existing subtitle and caption tracks generated or approved by video authors. If none are available and direct audio access is supported, it transcribes the speech using Cloudflare Workers AI Whisper. The resulting segments are normalized into timestamped paragraphs, TXT, SRT, and VTT.',
    },
    {
      question: 'Which platforms are currently supported?',
      answer:
        'YouTube (including all public desktop links, mobile youtu.be links, and YouTube Shorts) is fully supported with official and auto-generated caption tracks. Direct media links (.mp4, .webm, .mp3, .wav) are transcribed via Cloudflare Workers AI. Platform adapters for TikTok and Instagram are monitored; currently, third-party authentication policies restrict anonymous server access on those platforms, and we do not fabricate fake transcripts.',
    },
    {
      question: 'What happens when captions are unavailable for a video?',
      answer:
        'If a video has no creator captions or auto-generated subtitles available on YouTube, TextFromClip will notify you immediately with an honest explanation rather than inventing text. For direct media files, Cloudflare Workers AI Whisper is used to automatically generate speech-to-text.',
    },
    {
      question: 'What export formats can I download?',
      answer:
        'You can copy the entire transcript to your clipboard with one click, or download it as plain text (.txt), SubRip subtitle file (.srt), or WebVTT subtitle file (.vtt). Subtitle formats include exact millisecond timestamps suitable for video editing software like Premiere Pro, Final Cut, and DaVinci Resolve.',
    },
    {
      question: 'How accurate are the transcripts?',
      answer:
        'When official creator subtitles are available, accuracy is 100% matched to the author\'s original text. For auto-captions and Cloudflare Workers AI Whisper transcription, accuracy is typically 95%+ for clear audio with standard speech, accents, and minimal background noise.',
    },
    {
      question: 'What is your privacy and data retention policy?',
      answer:
        'We believe in zero-footprint utility software. TextFromClip requires no account or registration. We do not permanently store videos or transcript bodies in our database. Ephemeral operational job metadata (duration, provider, segment count) in Cloudflare D1 expires automatically after 24 hours. We do not sell data or run tracking scripts.',
    },
    {
      question: 'Why might a particular video link fail?',
      answer:
        'A link may fail if: (1) the video is private, unlisted, or age-restricted; (2) the URL was mistyped or points to an unsupported website; (3) the video contains no speech or disabled captions; or (4) the video is geo-restricted or deleted by the creator.',
    },
  ];

  return (
    <section id="faq" className="py-20 bg-white dark:bg-slate-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        
        <div className="text-center mb-16">
          <h2 className="text-xs uppercase tracking-widest font-bold text-blue-600 dark:text-blue-400 mb-3">
            Got Questions?
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Frequently Asked Questions
          </p>
          <p className="mt-4 text-base sm:text-lg text-slate-600 dark:text-slate-300">
            Clear, transparent answers about how TextFromClip works under the hood.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between p-5 sm:p-6 text-left focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white pr-4">
                    {faq.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-slate-500 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'transform rotate-180 text-blue-600 dark:text-blue-400' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-5 sm:px-6 pb-6 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800/80 pt-4 animate-in fade-in">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
