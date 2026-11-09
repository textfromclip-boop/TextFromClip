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
      No account needed for the free plan. Your study materials remain entirely yours.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm sm:text-base text-ink/90 leading-relaxed">
      <section>
        <h2 className="text-xl font-bold text-ink mb-2">1. Free Plan (Local Device Storage)</h2>
        <p>
          Free users never need to create an account, log in, or enter personal information. Your study decks, flashcards, spaced-repetition schedules, notes, and review streaks are stored solely on your local device using browser IndexedDB (labeled in the app as <strong>“Saved on this device”</strong>). We do not send your decks or study notes to any remote database on the free plan.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">2. Paid Passes & Cloud Storage Sync</h2>
        <p>
          When you purchase a paid plan (Exam Pass, Monthly subscription, or Semester Pass) or click <strong>“Save my streak”</strong>, you log in using a passwordless email magic link. To enable seamless multi-device studying, <strong>paid users’ study decks, flashcards, spaced-repetition intervals, and review streaks are stored and synced in the cloud</strong> via Cloudflare D1 databases and encrypted Cloudflare R2 storage. This allows you to revise and review your materials seamlessly across your laptop, tablet, and mobile phone.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">3. Uploaded Audio & Video Lectures</h2>
        <p>
          When you upload an audio or video file from your computer or phone, temporary audio chunks are staged in encrypted Cloudflare R2 storage and automatically deleted as soon as Whisper speech-to-text processing finishes (with a strict 24-hour bucket lifecycle rule as a backup). Transcripts and generated revision packs are cached on the server by video ID and transcript hash so repeated student lookups are instant.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">4. Fair-Use Quotas & Turnstile Protection</h2>
        <p>
          To protect students sharing campus Wi-Fi and university network addresses, anonymous daily quotas use signed browser cookie identifiers, coarse network rate limiting, and invisible Cloudflare Turnstile verification. We never sell student data or share private information with third-party ad networks.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">5. Data Deletion & Contact</h2>
        <p>
          You can delete local decks at any time from the <Link to="/study" className="text-accent font-semibold underline">Study</Link> page. To permanently delete your synced cloud account, remove stored decks, or ask privacy questions, email us at <span className="font-mono font-semibold text-ink">support@learnfromclip.com</span>.
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

    <article className="mt-8 bg-surface border border-rule rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm sm:text-base text-ink/90 leading-relaxed">
      <section>
        <h2 className="text-xl font-bold text-ink mb-2">1. Educational & Personal Use</h2>
        <p>
          LearnFromClip (<span className="font-semibold text-ink">learnfromclip.com</span>) is an educational lecture-to-learning tool that converts public video clips and user-uploaded lecture recordings into transcripts, structured notes, flashcards, and practice quizzes. You are responsible for ensuring you have the legal right or fair-use permission to process any recording you upload.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">2. Accuracy & Source Verification</h2>
        <p>
          Every generated note bullet, flashcard, and quiz question includes a verbatim quote and timestamp linking directly to the underlying lecture video or audio. Automated speech recognition can occasionally mishear words in noisy classrooms or specialized terminology; always verify critical exam, medical, or clinical material against the original lecture source.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">3. Merchant of Record & Payments</h2>
        <p>
          Our order process is conducted by our online reseller <strong>Lemon Squeezy (Lemon Squeezy, LLC)</strong>. Lemon Squeezy is the Merchant of Record for all our orders. Lemon Squeezy handles order fulfillment, international taxes, and customer returns. All purchases are backed by our <Link to="/refund" className="text-accent font-semibold underline">14-Day Refund Policy</Link>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">4. Plans, Passes & Subscriptions</h2>
        <p>
          <strong>Exam Pass</strong> (7 days) and <strong>Semester Pass</strong> (4 months) are one-time payments that never auto-renew. The <strong>Monthly</strong> plan is a recurring subscription that you can cancel at any time with one click from your billing receipt or by contacting support. Upon cancellation, you retain full access until the end of the paid billing period.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">5. Fair Use & Prohibited Conduct</h2>
        <p>
          Usage is subject to the daily and monthly fair-use limits detailed on our <Link to="/pricing" className="text-accent font-semibold underline">Pricing</Link> page. Reverse engineering, programmatic scraping, and artificial multi-account referral abuse are strictly prohibited.
        </p>
      </section>
    </article>
  </div>
);

export const RefundPolicyPage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-4 sm:px-5 pt-10 sm:pt-14 pb-16">
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-200">
      14-Day Money-Back Guarantee
    </div>
    <h1 className="mt-3 text-3xl sm:text-5xl font-black tracking-tight text-ink leading-[1.1]">
      Refund Policy
    </h1>
    <p className="mt-3 text-base sm:text-lg text-muted">
      We stand behind LearnFromClip with a hassle-free, 100% money-back guarantee.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm sm:text-base text-ink/90 leading-relaxed">
      <section>
        <h2 className="text-xl font-bold text-ink mb-2">1. 14-Day 100% Money-Back Guarantee</h2>
        <p>
          If you purchase an Exam Pass, Monthly subscription, or Semester Pass and decide LearnFromClip is not right for your study routine, you are eligible for a full 100% refund within <strong>14 days of purchase</strong>. No complicated questions asked.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">2. How to Request a Refund</h2>
        <p>
          Requesting a refund takes less than a minute. You can either:
        </p>
        <ul className="list-disc pl-6 space-y-2 mt-2">
          <li>
            Send an email to <span className="font-mono font-semibold text-ink">support@learnfromclip.com</span> with your purchase email address or order number.
          </li>
          <li>
            Reply directly to your Lemon Squeezy order confirmation email requesting a refund.
          </li>
        </ul>
        <p className="mt-2">
          Our support team responds to refund requests within 24 hours on business days.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">3. Refund Processing & Payout Timeline</h2>
        <p>
          Once approved, refunds are initiated immediately through Lemon Squeezy. Depending on your bank or credit card provider, the funds typically appear back in your account within <strong>3 to 5 business days</strong>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">4. Canceling Monthly Subscriptions</h2>
        <p>
          If you are on the Monthly subscription plan, you can cancel renewal at any time. Simply click the customer billing portal link in your purchase receipt or email <span className="font-mono font-semibold text-ink">support@learnfromclip.com</span>. When you cancel, you keep full access to all paid features until the current monthly cycle ends, and your card will never be charged again.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">5. Merchant of Record</h2>
        <p>
          Our order process is conducted by our online reseller <strong>Lemon Squeezy (Lemon Squeezy, LLC)</strong>. Lemon Squeezy is the Merchant of Record for all our orders. Lemon Squeezy handles order fulfillment, customer billing inquiries, chargebacks, and returns.
        </p>
      </section>
    </article>
  </div>
);
