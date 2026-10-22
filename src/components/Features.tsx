import React from 'react';
import { Link2, Clock, Download, ShieldCheck } from 'lucide-react';

export const Features: React.FC = () => {
  const featureList = [
    {
      icon: Link2,
      color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60',
      title: 'Simple Link-to-Transcript',
      description:
        'Just paste a public video URL and get clean, readable text immediately. No browser extensions, no cumbersome software, and no downloads required.',
    },
    {
      icon: Clock,
      color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60',
      title: 'Timestamped Transcripts',
      description:
        'Every spoken sentence is linked to its exact moment in the clip. Click any timestamp to jump straight to that second in the source video.',
    },
    {
      icon: Download,
      color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60',
      title: 'Copy & Multi-Format Exports',
      description:
        'Copy the full transcript in one click or download formatted SubRip (.srt) and WebVTT (.vtt) subtitles ready for video editors and media players.',
    },
    {
      icon: ShieldCheck,
      color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60',
      title: 'No Account Required',
      description:
        'Enjoy a hassle-free, privacy-first experience. No signups, no logins, no credit cards, and no user profiles. Your video queries are never permanently logged.',
    },
  ];

  return (
    <section id="features" className="py-20 bg-slate-50/60 dark:bg-slate-900/40 border-y border-slate-100 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs uppercase tracking-widest font-bold text-blue-600 dark:text-blue-400 mb-3">
            Core Features
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Designed for speed, clarity, and zero friction
          </p>
          <p className="mt-4 text-base sm:text-lg text-slate-600 dark:text-slate-300">
            Everything you need to turn spoken videos into searchable, reusable text.
          </p>
        </div>

        {/* 4-Card Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {featureList.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <div
                key={idx}
                className="flex flex-col p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-card-hover hover:border-blue-200 dark:hover:border-blue-800 transition-all duration-200 group"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${feature.color} group-hover:scale-110 transition-transform`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2.5">
                  {feature.title}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
