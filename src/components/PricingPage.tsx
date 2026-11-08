import React, { useEffect, useState } from 'react';
import { Link } from '../router';
import { trackEvent } from '../utils/analytics';

export const PricingPage: React.FC = () => {
  const [showRegional, setShowRegional] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);

  useEffect(() => {
    trackEvent('pricing_viewed', '/pricing');
  }, []);

  // Referral state
  const [refEmail, setRefEmail] = useState('');
  const [refCodeLink, setRefCodeLink] = useState<string | null>(null);
  const [refCopied, setRefCopied] = useState(false);

  const handleStartCheckout = async (planId: 'exam_pass' | 'monthly' | 'semester_pass') => {
    trackEvent('checkout_started', '/pricing');
    setCheckoutPlan(planId);
    setCheckoutNotice(null);
  };

  const handleConfirmCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutEmail.trim() || !checkoutPlan) return;
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: checkoutPlan,
          email: checkoutEmail.trim(),
        }),
      });
      const json: any = await res.json();
      if (json?.data?.checkoutUrl) {
        window.location.href = json.data.checkoutUrl;
        return;
      }
      setCheckoutNotice(
        json?.data?.message ||
          'Checkout session ready! Configure your Lemon Squeezy store URL in environment variables to accept live card payments.'
      );
    } catch {
      setCheckoutNotice('Could not start checkout right now. Please try again.');
    }
  };

  const handleGenerateReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refEmail.trim()) return;
    try {
      const res = await fetch('/api/referral/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: refEmail.trim() }),
      });
      const json: any = await res.json();
      if (res.ok && json?.data?.referralCode) {
        const link = `https://learnfromclip.com/?ref=${json.data.referralCode}`;
        setRefCodeLink(link);
        trackEvent('referral_sent', '/pricing');
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 pt-10 sm:pt-14 pb-16">
      <div className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-accent-soft text-accent text-xs font-bold">
          Student-Friendly Pricing
        </div>
        <h1 className="mt-3 text-3xl sm:text-5xl font-black tracking-tight text-ink leading-[1.1]">
          Simple passes for{' '}
          <span className="bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] bg-clip-text text-transparent">
            exam season.
          </span>
        </h1>
        <p className="mt-3 text-base sm:text-lg text-muted font-medium">
          Less than the price of one coffee a month.
        </p>

        {/* Regional Pricing Preview Toggle */}
        <div className="mt-5 inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-surface border border-rule shadow-sm text-xs font-semibold text-ink">
          <span>Standard Prices</span>
          <button
            type="button"
            onClick={() => setShowRegional((r) => !r)}
            aria-label="Toggle regional pricing preview"
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              showRegional ? 'bg-accent' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                showRegional ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-accent font-bold">
            Regional Student Pricing* (50% off)
          </span>
        </div>
      </div>

      {/* 3 PAID CARDS: Exam Pass | Monthly | Semester Pass ("Best value") */}
      <div className="mt-10 grid md:grid-cols-3 gap-6 items-stretch">
        {/* Card 1: Exam Pass */}
        <div className="rounded-2xl border border-rule bg-surface p-6 sm:p-7 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-ink">Exam Pass</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-ink text-[11px] font-bold">
                No auto-renew
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              One-time 7-day pass for finals or midterm week.
            </p>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-black text-ink">
                {showRegional ? '$1.49' : '$2.99'}
              </span>
              <span className="text-sm font-semibold text-muted">/ 7 days</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              One-time payment · Never auto-renews
            </p>

            <ul className="mt-6 space-y-2.5 text-sm text-ink/90">
              <li>✓ <strong>50 lecture links</strong> per day</li>
              <li>✓ <strong>10 hours</strong> of audio upload per week</li>
              <li>✓ <strong>100 AI revision packs</strong> & actions per day</li>
              <li>✓ Up to <strong>150 flashcards</strong> per pack</li>
              <li>✓ <strong>Unlimited</strong> mock exams & quizzes</li>
              <li>✓ Lectures up to <strong>4 hours</strong> long</li>
              <li>✓ <strong>Cloud sync</strong> across devices via magic link</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => handleStartCheckout('exam_pass')}
            className="mt-7 w-full py-3 px-4 rounded-xl border-2 border-ink bg-ink text-white font-bold text-sm hover:opacity-95 transition-opacity"
          >
            Get 7-Day Exam Pass →
          </button>
        </div>

        {/* Card 2: Monthly */}
        <div className="rounded-2xl border border-rule bg-surface p-6 sm:p-7 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-ink">Monthly</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-bold">
                Cancel anytime
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Flexible month-to-month access for ongoing classes.
            </p>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-black text-ink">
                {showRegional ? '$2.49' : '$4.99'}
              </span>
              <span className="text-sm font-semibold text-muted">/ month</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-muted">
              Subscription · Cancel in one click anytime
            </p>

            <ul className="mt-6 space-y-2.5 text-sm text-ink/90">
              <li>✓ <strong>50 lecture links</strong> per day</li>
              <li>✓ <strong>30 hours</strong> of audio upload per month</li>
              <li>✓ <strong>100 AI revision packs</strong> & actions per day</li>
              <li>✓ Up to <strong>150 flashcards</strong> per pack</li>
              <li>✓ <strong>Unlimited</strong> mock exams & quizzes</li>
              <li>✓ Lectures up to <strong>4 hours</strong> long</li>
              <li>✓ <strong>Cloud sync</strong> across devices via magic link</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => handleStartCheckout('monthly')}
            className="mt-7 w-full py-3 px-4 rounded-xl border-2 border-accent text-accent font-bold text-sm hover:bg-accent-soft transition-colors"
          >
            Start Monthly Plan →
          </button>
        </div>

        {/* Card 3: Semester Pass (Highlighted as "Best value") */}
        <div className="relative rounded-2xl border-2 border-accent bg-surface p-6 sm:p-7 shadow-[0_20px_50px_-12px_rgba(46,98,244,0.22)] flex flex-col justify-between">
          <div className="absolute -top-3.5 right-6 px-3 py-1 rounded-full bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] text-white text-xs font-extrabold shadow-md">
            Best value
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-ink">Semester Pass</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                No auto-renew
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Full 4-month term coverage with one payment.
            </p>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-black text-ink">
                {showRegional ? '$7.49' : '$14.99'}
              </span>
              <span className="text-sm font-semibold text-muted">/ 4 months</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              One-time payment · Never auto-renews
            </p>

            <ul className="mt-6 space-y-2.5 text-sm text-ink/90">
              <li>✓ <strong>50 lecture links</strong> per day</li>
              <li>✓ <strong>30 hours</strong> of audio upload per month</li>
              <li>✓ <strong>100 AI revision packs</strong> & actions per day</li>
              <li>✓ Up to <strong>150 flashcards</strong> per pack</li>
              <li>✓ <strong>Unlimited</strong> mock exams & quizzes</li>
              <li>✓ Lectures up to <strong>4 hours</strong> long</li>
              <li>✓ <strong>Cloud sync</strong> across devices via magic link</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => handleStartCheckout('semester_pass')}
            className="mt-7 w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] text-white font-extrabold text-sm shadow-lg hover:opacity-95 transition-opacity"
          >
            Get 4-Month Semester Pass →
          </button>
        </div>
      </div>

      {/* Free Plan Comparison Strip */}
      <div className="mt-8 rounded-2xl border border-rule bg-surface p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-2.5 py-0.5 rounded bg-slate-100 text-xs font-bold text-ink">
            Free Tier ($0 · No sign-up required)
          </span>
          <p className="mt-1.5 text-xs sm:text-sm text-muted">
            Includes <strong>5 links/day</strong>, <strong>20 minutes of audio upload/day</strong>,{' '}
            <strong>3 AI actions/day</strong>, <strong>30 cards/pack</strong>, <strong>1 mock exam/day</strong>, and{' '}
            <strong>unlimited</strong> browser-saved decks & PDF/Anki/Markdown exports.
          </p>
        </div>
        <Link
          to="/app"
          className="shrink-0 px-4 py-2.5 rounded-xl border border-rule font-bold text-xs sm:text-sm text-ink hover:border-accent"
        >
          Use Free Plan →
        </Link>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        *Regional pricing is automatically applied at checkout for cards billed in Egypt, Turkey, India, Pakistan, Morocco, Indonesia, and similar lower-income countries.
      </p>

      {/* Referral Box: "Invite a friend" */}
      <div className="mt-12 rounded-2xl bg-gradient-to-r from-[#021433] via-[#0B2559] to-[#1E1B4B] p-6 sm:p-8 text-white shadow-xl">
        <div className="grid md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-7">
            <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-sky-300 text-xs font-bold">
              🎁 Invite a friend
            </span>
            <h2 className="mt-2 text-2xl font-black text-white">
              Give 3 days of Exam Pass, get 3 days free.
            </h2>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-300 leading-relaxed">
              Share your personal invite link with a classmate. When your friend creates their first revision deck, you both get a free <strong>3-day Exam Pass</strong> (up to 5 rewards per student).
            </p>
          </div>

          <div className="md:col-span-5">
            <form onSubmit={handleGenerateReferral} className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                required
                value={refEmail}
                onChange={(e) => setRefEmail(e.target.value)}
                placeholder="Enter your email for invite link"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-slate-300 text-sm focus:outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] text-white font-bold text-xs sm:text-sm shrink-0"
              >
                Invite a friend
              </button>
            </form>

            {refCodeLink && (
              <div className="mt-3 p-3 rounded-xl bg-white/10 border border-white/20 flex items-center justify-between gap-2 text-xs">
                <code className="font-mono text-sky-200 truncate">{refCodeLink}</code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(refCodeLink);
                    setRefCopied(true);
                    setTimeout(() => setRefCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded bg-white text-[#021433] font-bold shrink-0"
                >
                  {refCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Checkout Modal */}
      {checkoutPlan && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface border border-rule p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-ink">
                Continue to Checkout ({checkoutPlan.replace('_', ' ')})
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCheckoutPlan(null);
                  setCheckoutNotice(null);
                }}
                className="text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Enter your email so your pass and magic-link deck sync are linked to your account immediately after payment.
            </p>
            <form onSubmit={handleConfirmCheckout} className="mt-4 space-y-3">
              <input
                type="email"
                required
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full px-3.5 py-2.5 rounded-xl border border-rule text-sm text-ink"
              />
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1287FA] via-[#2E62F4] to-[#4835F0] text-white font-bold text-sm"
              >
                Proceed to Secure Payment →
              </button>
            </form>
            {checkoutNotice && (
              <p className="mt-3 p-3 rounded-xl bg-accent-soft text-accent text-xs font-semibold">
                {checkoutNotice}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
