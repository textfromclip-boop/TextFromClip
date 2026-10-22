import React from 'react';
import { X, Shield, FileText, Mail } from 'lucide-react';

export type ModalType = 'privacy' | 'terms' | 'contact' | null;

interface ModalsProps {
  activeModal: ModalType;
  onClose: () => void;
}

export const Modals: React.FC<ModalsProps> = ({ activeModal, onClose }) => {
  if (!activeModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8"
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {activeModal === 'privacy' && (
          <div>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Privacy Policy</h3>
                <p className="text-xs text-slate-500">Effective Date: October 2026</p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-white">1. No User Accounts</p>
              <p>
                TextFromClip does not require registration, login, email addresses, or user accounts. We do not collect or store personal profiles.
              </p>

              <p className="font-semibold text-slate-900 dark:text-white">2. Video URL and Media Processing</p>
              <p>
                When you input a video link, our Cloudflare edge worker queries the relevant provider (e.g. YouTube) to retrieve available caption files or process accessible audio via Cloudflare Workers AI. We do not permanently store video files, audio streams, or the generated transcripts.
              </p>

              <p className="font-semibold text-slate-900 dark:text-white">3. Operational Metadata & Retention</p>
              <p>
                We store minimal operational metadata in Cloudflare D1 for abuse prevention and rate limiting. Records include job ID, provider name, duration, and timestamp. All job metadata records automatically expire and are purged after 24 hours.
              </p>

              <p className="font-semibold text-slate-900 dark:text-white">4. No Third-Party Trackers or Advertising</p>
              <p>
                We do not use advertising networks, cookie-tracking pixels, or data brokers. We do not sell any information to third parties.
              </p>
            </div>
          </div>
        )}

        {activeModal === 'terms' && (
          <div>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Terms of Service</h3>
                <p className="text-xs text-slate-500">Effective Date: October 2026</p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-white">1. Acceptable Use</p>
              <p>
                TextFromClip is provided as a free utility for personal, educational, research, and fair-use informational purposes. You agree not to submit malicious URLs, launch denial-of-service attacks, or attempt to bypass rate limits.
              </p>

              <p className="font-semibold text-slate-900 dark:text-white">2. Copyright & Intellectual Property</p>
              <p>
                Transcripts are generated from publicly accessible captions and audio created by original content creators. Users are responsible for complying with the copyright and licensing terms of the original content. TextFromClip claims no ownership over the transcribed text.
              </p>

              <p className="font-semibold text-slate-900 dark:text-white">3. Platform Restrictions</p>
              <p>
                We respect third-party platform terms of service and access policies. If a video platform restricts public API or caption access, TextFromClip will not bypass authentication, DRM, or access controls.
              </p>

              <p className="font-semibold text-slate-900 dark:text-white">4. Disclaimer of Warranties</p>
              <p>
                The service is provided "as is" without warranty of any kind. While we aim for high accuracy, auto-generated captions and speech recognition may contain transcription errors.
              </p>
            </div>
          </div>
        )}

        {activeModal === 'contact' && (
          <div>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Contact & Support</h3>
                <p className="text-xs text-slate-500">Inquiries and Abuse Reports</p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <p>
                Have a question, feedback, or need to report an issue or abusive URL? You can reach the TextFromClip team directly at:
              </p>
              
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                <p className="font-semibold text-slate-900 dark:text-white mb-1">General Inquiries & Feedback</p>
                <p className="font-mono text-blue-600 dark:text-blue-400">support@textfromclip.com</p>
                
                <p className="font-semibold text-slate-900 dark:text-white mt-4 mb-1">Abuse & DMCA Compliance</p>
                <p className="font-mono text-blue-600 dark:text-blue-400">abuse@textfromclip.com</p>
              </div>

              <p className="text-xs text-slate-500">
                We respond to verified inquiries within 2 business days.
              </p>
            </div>
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
