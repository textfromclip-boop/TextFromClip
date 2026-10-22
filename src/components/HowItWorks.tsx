import React from 'react';
import { ClipboardPaste, Cpu, Download } from 'lucide-react';

export const HowItWorks: React.FC = () => {
  const steps = [
    {
      step: '01',
      icon: ClipboardPaste,
      title: 'Paste Video Link',
      description:
        'Copy the URL of any public video or clip (such as YouTube videos, Shorts, or direct media links) and paste it into the search box.',
    },
    {
      step: '02',
      icon: Cpu,
      title: 'Automatic Processing',
      description:
        'Our provider adapter immediately retrieves available official caption tracks or processes the audio stream with Cloudflare Workers AI speech recognition.',
    },
    {
      step: '03',
      icon: Download,
      title: 'Read, Copy & Export',
      description:
        'Search through timestamped text, copy lines directly to your notes, or export formatted TXT, SRT, or VTT files in seconds.',
    },
  ];

  return (
    <section id="how-it-works" className="py-20 bg-white dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs uppercase tracking-widest font-bold text-purple-600 dark:text-purple-400 mb-3">
            Workflow
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            How It Works
          </p>
          <p className="mt-4 text-base sm:text-lg text-slate-600 dark:text-slate-300">
            Three straightforward steps to transform any video into clean text.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="relative flex flex-col p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Step badge */}
                <span className="font-mono text-3xl font-black text-slate-200 dark:text-slate-800 mb-4 select-none">
                  {item.step}
                </span>

                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-500/10 to-purple-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-6">
                  <Icon className="w-6 h-6" />
                </div>

                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                  {item.title}
                </h3>

                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
