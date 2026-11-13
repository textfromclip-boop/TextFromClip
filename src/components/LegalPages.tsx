import React from 'react';
import { Link } from '../router';

export const PrivacyPage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-4 sm:px-5 pt-10 sm:pt-14 pb-16">
    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
      Privacy Policy
    </div>
    <h1 className="mt-3 text-3xl sm:text-5xl font-medium tracking-tight text-ink leading-[1.1]">
      Privacy & Data Storage
    </h1>
    <p className="mt-3 text-base sm:text-lg text-muted">
      No account needed for the free plan. Your study materials remain entirely yours.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-lg p-6 sm:p-8 space-y-6 text-sm sm:text-base text-ink/90 leading-relaxed">
      <section>
        <h2 className="text-xl font-bold text-ink mb-2">1. Free Plan (Local Device Storage)</h2>
        <p>
          Free users never need to create an account, log in, or enter personal information. Your study decks, flashcards, spaced-repetition schedules, notes, and review streaks are stored solely on your local device using browser IndexedDB (labeled in the app as <strong>“Saved on this device”</strong>). We do not send your decks or study notes to any remote database on the free plan.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">2. Paid Passes & Cloud Storage Sync</h2>
        <p>
          With an Exam Pass, Monthly plan or Semester Pass you can sign in using <strong>Continue with Google</strong> (or an email sign-in link). We then store your Google account email address, display name, your plan and its expiry date, and your study decks (cards, review schedule) in our database on Cloudflare so you can study across devices.
        </p>
        <p className="mt-2">
          Payments are handled by <strong>Lemon Squeezy</strong>, our merchant of record. We never see or store your card details; Lemon Squeezy shares your email, the product you bought and your billing country with us so we can activate your pass.
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
          Free daily limits use a signed, anonymous browser cookie plus a shared per-network ceiling, and may ask you to pass an invisible Cloudflare Turnstile check. For rate limits and quotas we store only a one-way hash of your IP address, never the address itself, and these counters are kept per day. Product analytics are aggregate event counts (for example “quiz finished”) with the page path and plan type only: no names, emails, IP addresses or lecture content. We do not sell personal data or use ad networks.
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
    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
      Terms of Service
    </div>
    <h1 className="mt-3 text-3xl sm:text-5xl font-medium tracking-tight text-ink leading-[1.1]">
      Terms of Use
    </h1>
    <p className="mt-3 text-base sm:text-lg text-muted">
      Clear terms for students, educators, and lifelong learners using LearnFromClip.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-lg p-6 sm:p-8 space-y-6 text-sm sm:text-base text-ink/90 leading-relaxed">
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
        <p className="mt-2">
          Regional student prices are only available for billing addresses in the listed countries. If a regional price is used with a billing country outside those countries, the pass is not activated and the payment is refunded.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-ink mb-2">5. Fair Use & Prohibited Conduct</h2>
        <p>
          Usage is subject to the daily and monthly fair-use limits detailed on our <Link to="/pricing" className="text-accent font-semibold underline">Pricing</Link> page. Reverse engineering, programmatic scraping, and artificial multi-account referral abuse are strictly prohibited. Daily limits reset at 00:00 UTC. Self-referrals from the same device, browser or account do not earn referral passes, and each person can receive at most 5 referral rewards.
        </p>
      </section>
    </article>
  </div>
);

export const RefundPolicyPage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-4 sm:px-5 pt-10 sm:pt-14 pb-16">
    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
      14-Day Money-Back Guarantee
    </div>
    <h1 className="mt-3 text-3xl sm:text-5xl font-medium tracking-tight text-ink leading-[1.1]">
      Refund Policy
    </h1>
    <p className="mt-3 text-base sm:text-lg text-muted">
      We stand behind LearnFromClip with a hassle-free, 100% money-back guarantee.
    </p>

    <article className="mt-8 bg-surface border border-rule rounded-lg p-6 sm:p-8 space-y-6 text-sm sm:text-base text-ink/90 leading-relaxed">
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
          Once approved, refunds are initiated immediately through Lemon Squeezy. Depending on your bank or credit card provider, the funds typically appear back in your account within <strong>3 to 5 business days</strong>. When a payment is refunded, the paid features it unlocked end immediately and your account returns to the Free plan; decks already saved on your device are kept.
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
