import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';

export const SupportedPlatforms: React.FC = () => {
  const platforms = [
    {
      name: 'YouTube',
      status: 'Fully Operational',
      statusColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      icon: CheckCircle2,
      description:
        'Supports all public YouTube watch links, mobile youtu.be links, and YouTube Shorts. Extracts official author captions and auto-generated subtitle tracks with high accuracy.',
      formats: ['youtube.com/watch?v=...', 'youtu.be/...', 'youtube.com/shorts/...'],
      badge: 'Primary Provider',
    },
    {
      name: 'Direct Media Files (.mp4, .mp3, .webm)',
      status: 'Fully Operational',
      statusColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      icon: CheckCircle2,
      description:
        'Transcribes accessible direct video and audio URLs using Cloudflare Workers AI Whisper speech recognition models.',
      formats: ['.mp4', '.webm', '.mp3', '.wav', '.m4a'],
      badge: 'Cloudflare AI Whisper',
    },
    {
      name: 'TikTok Video Clips',
      status: 'Restricted by Platform',
      statusColor: 'bg-amber-50 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      icon: AlertTriangle,
      description:
        'TikTok restricts public caption access and requires authenticated mobile app sessions. TextFromClip strictly adheres to our anti-fabrication policy and reports platform restrictions honestly.',
      formats: ['tiktok.com/@user/video/...', 'vt.tiktok.com/...'],
      badge: 'Platform Policy',
    },
    {
      name: 'Instagram Reels',
      status: 'Requires Login / Restricted',
      statusColor: 'bg-amber-50 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      icon: ShieldAlert,
      description:
        'Meta login walls restrict anonymous server requests. We never fabricate transcripts or claim videos were processed when platform restrictions prevent access.',
      formats: ['instagram.com/reel/...', 'instagram.com/p/...'],
      badge: 'Auth Gated',
    },
  ];

  return (
    <section id="platforms" className="py-20 bg-slate-50/60 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs uppercase tracking-widest font-bold text-blue-600 dark:text-blue-400 mb-3">
            Integration Transparency
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Supported Platforms & Status
          </p>
          <p className="mt-4 text-base sm:text-lg text-slate-600 dark:text-slate-300">
            We only display real capabilities. No synthetic mocks or simulated transcripts.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {platforms.map((p, idx) => {
            const StatusIcon = p.icon;
            return (
              <div
                key={idx}
                className="flex flex-col justify-between p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                      {p.name}
                    </h3>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {p.badge}
                    </span>
                  </div>

                  <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border mb-4 ${p.statusColor}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    <span>{p.status}</span>
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
                    {p.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Supported URL Formats:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {p.formats.map((fmt, i) => (
                      <code
                        key={i}
                        className="text-xs font-mono px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        {fmt}
                      </code>
                    ))}
                  </div>
                </div>

              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
};
