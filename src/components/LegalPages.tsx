import React from 'react';
import { Link } from '../router';

export const PrivacyPage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-4 sm:px-5 pt-10 sm:pt-14 pb-16">
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent text-xs font-bold">
      Privacy Policy
    </div>
    <h1 className="mt-3 text-3xl sm:text-5xl font-black tracking-tight text-ink leading-[1.1]">
      Privacy & Data Storage
    </h1>
    <p className="mt-3 text-base sm:text-lg text-muted">
      No account needed. On the free plan, your notes stay on your device.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-2xl p-6 sm:p-8 shadow-sm space-y-5 text-sm sm:text-base text-ink/90 leading-relaxed">
      <section>
        <h2 className="text-xl font-bold text-ink mb-2">1. Free Plan (Local Browser Storage)</h2>
        <p>
          Free users never need to create an account or enter an email address. Your study decks, flashcards, spaced-repetition schedules, and review streaks are saved locally in your browser using IndexedDB (marked as <strong>“Saved on this device”</strong>).
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">2. Paid Passes & Cloud Sync</h2>
        <p>
          When you purchase an Exam Pass, Monthly plan, or Semester Pass—or click <strong>“Save my streak”</strong>—you sign in with an email magic link (no passwords). Your synced study decks, card intervals, and entitlement expiry dates are stored in our Cloudflare D1 database so you can study across devices.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">3. Uploaded Files & Lecture Caching</h2>
        <p>
          When you upload an audio or video recording from your device, temporary audio chunks are staged in Cloudflare R2 and automatically deleted immediately after Whisper speech-to-text completes (with a 24-hour bucket lifecycle rule as a backup). To make repeat student lookups fast and affordable, transcripts and generated revision packs are cached on the server by video ID and transcript hash.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">4. Fair-Use Quotas & Abuse Protection</h2>
        <p>
          To protect university students who share campus IP addresses, anonymous daily limits use a combination of a signed cookie ID, coarse network checks, and invisible Cloudflare Turnstile verification. We use privacy-friendly aggregate event counters without selling personal data or running third-party ad networks.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">5. Contact & Deletion Requests</h2>
        <p>
          You can delete local decks at any time from the <Link to="/study" className="text-accent font-semibold underline">Study</Link> page. To delete a synced cloud account or ask privacy questions, email <span className="font-mono font-semibold">support@learnfromclip.com</span>.
        </p>
      </section>
    </article>
  </div>
);

export const TermsPage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-4 sm:px-5 pt-10 sm:pt-14 pb-16">
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft text-accent text-xs font-bold">
      Terms of Service
    </div>
    <h1 className="mt-3 text-3xl sm:text-5xl font-black tracking-tight text-ink leading-[1.1]">
      Terms of Use
    </h1>
    <p className="mt-3 text-base sm:text-lg text-muted">
      Clear terms for students, educators, and lifelong learners using LearnFromClip.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-2xl p-6 sm:p-8 shadow-sm space-y-5 text-sm sm:text-base text-ink/90 leading-relaxed">
      <section>
        <h2 className="text-xl font-bold text-ink mb-2">1. Educational & Personal Use</h2>
        <p>
          LearnFromClip (learnfromclip.com) is a lecture-to-learning tool that converts public video clips and user-uploaded lecture recordings into transcripts, structured notes, flashcards, and quizzes. You are responsible for ensuring you have the right to process any recording you upload.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">2. Accuracy & Source Verification</h2>
        <p>
          Every generated note bullet, flashcard, and quiz question includes a verbatim quote and timestamp from the underlying transcript, and any extra AI context is labeled separately as <strong>“AI explanation”</strong>. However, automated speech recognition can mishear words in noisy audio—always verify critical exam or clinical material against the linked lecture audio.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">3. Plans, Passes & Refunds</h2>
        <p>
          <strong>Exam Pass</strong> (7 days) and <strong>Semester Pass</strong> (4 months) are one-time purchases that never auto-renew. The <strong>Monthly</strong> plan is a recurring subscription that you can cancel anytime. Payments and international taxes are processed by our merchant of record. If a pass is refunded, paid entitlements revert to the Free plan immediately.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">4. Fair Use & Referral Rules</h2>
        <p>
          Free and paid plans are subject to the daily and monthly fair-use limits listed on our <Link to="/pricing" className="text-accent font-semibold underline">Pricing</Link> page. Self-referrals from the same device, cookie, or account are not eligible for referral passes.
        </p>
      </section>
    </article>
  </div>
);
