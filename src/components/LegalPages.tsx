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
          With an Exam Pass, Monthly plan or Semester Pass you can sign in with an email magic link (no passwords). We then store your email address, your plan and its expiry date, and your study decks (cards, review schedule) in our database on Cloudflare so you can study across devices. Sign-in links are single-use, expire after 15 minutes and are stored only as a one-way hash. Sign-in emails are sent by our email provider (Resend).
        </p>
        <p className="mt-2">
          Payments are handled by <strong>Lemon Squeezy</strong>, our merchant of record. We never see or store your card details; Lemon Squeezy shares your email, the product you bought and your billing country with us so we can activate your pass.
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
          Free daily limits use a signed, anonymous browser cookie plus a shared per-network ceiling, and may ask you to pass an invisible Cloudflare Turnstile check. For rate limits and quotas we store only a one-way hash of your IP address, never the address itself, and these counters are kept per day. Product analytics are aggregate event counts (for example “quiz finished”) with the page path and plan type only: no names, emails, IP addresses or lecture content. We do not sell personal data or use ad networks.
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
        <h2 className="text-xl font-bold text-ink mb-2">3. Plans, Passes & Payments</h2>
        <p>
          <strong>Exam Pass</strong> (7 days) and <strong>Semester Pass</strong> (4 months) are one-time purchases that never auto-renew. The <strong>Monthly</strong> plan is a recurring subscription that you can cancel at any time; after cancelling you keep access until the end of the period you paid for. Our order process is conducted by our online reseller <strong>Lemon Squeezy</strong>, who is the Merchant of Record for all our orders and handles payments, taxes and invoices.
        </p>
        <p className="mt-2">
          Regional student prices are only available for billing addresses in the listed countries. If a regional price is used with a billing country outside those countries, the pass is not activated and the payment is refunded.
        </p>
      </section>

      <section id="refunds">
        <h2 className="text-xl font-bold text-ink mb-2">4. Refund Policy</h2>
        <p>
          If LearnFromClip does not work for you, email <span className="font-mono font-semibold">support@learnfromclip.com</span> within <strong>14 days</strong> of your purchase (or of a Monthly renewal) with the email address you used at checkout, and we will refund that payment in full. Refunds are issued through Lemon Squeezy to your original payment method. When a payment is refunded, the paid features it unlocked end immediately and your account returns to the Free plan; decks already saved on your device are kept. This does not affect any statutory rights you have under consumer law in your country.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">5. Fair Use & Referral Rules</h2>
        <p>
          Free and paid plans are subject to the daily, weekly and monthly fair-use limits listed on our <Link to="/pricing" className="text-accent font-semibold underline">Pricing</Link> page; daily limits reset at 00:00 UTC. Self-referrals from the same device, browser or account are not eligible for referral passes, and each person can receive at most 5 referral rewards.
        </p>
      </section>
    </article>
  </div>
);
