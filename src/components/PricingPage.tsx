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
          plan: checkoutPlan,
          email: checkoutEmail.trim(),
        }),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.data?.checkoutUrl) {
        window.location.href = json.data.checkoutUrl;
        return;
      }
      setCheckoutNotice(
        json?.error?.message || 'Could not start checkout right now. Please try again.'
      );
    } catch {
      setCheckoutNotice('Could not start checkout right now. Please try again.');
    }
  };

  const handleGenerateReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // The invite is tied to this browser (or your signed-in account): no email needed.
      const res = await fetch('/api/referral/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json: any = await res.json();
      if (res.ok && json?.data?.shareUrl) {
        setRefCodeLink(json.data.shareUrl);
        trackEvent('referral_sent', '/pricing');
      }
    } catch {
      // ignore
    }
  };

  const PLANS: {
    id: 'exam_pass' | 'monthly' | 'semester_pass';
    name: string;
    price: string;
    regional: string;
    per: string;
    billing: string;
    blurb: string;
    upload: string;
    cta: string;
    featured?: boolean;
  }[] = [
    {
      id: 'exam_pass',
      name: 'Exam Pass',
      price: '$2.99',
      regional: '$1.49',
      per: '7 days',
      billing: 'One-time payment. Never renews.',
      blurb: 'For finals or midterm week.',
      upload: '10 hours of uploads per week',
      cta: 'Get 7-Day Exam Pass',
    },
    {
      id: 'semester_pass',
      name: 'Semester Pass',
      price: '$14.99',
      regional: '$7.49',
      per: '4 months',
      billing: 'One-time payment. Never renews.',
      blurb: 'A whole term for the price of three exam weeks.',
      upload: '30 hours of uploads per month',
      cta: 'Get 4-Month Semester Pass',
      featured: true,
    },
    {
      id: 'monthly',
      name: 'Monthly',
      price: '$4.99',
      regional: '$2.49',
      per: 'month',
      billing: 'Subscription. Cancel anytime.',
      blurb: 'Month to month, for ongoing classes.',
      upload: '30 hours of uploads per month',
      cta: 'Start Monthly Plan',
    },
  ];

  const COMPARISON: [string, string, string][] = [
    ['Lecture links', '5 per day', '50 per day'],
    ['Audio and video uploads', '20 minutes per day', '10 h per week (Exam) · 30 h per month'],
    ['AI actions (packs, translations, formats)', '3 per day', '100 per day'],
    ['Flashcards per pack', '30', '150'],
    ['Quizzes', '1 per day', 'Unlimited'],
    ['Longest lecture', '2 hours', '4 hours'],
    ['Where your decks live', 'On this device', 'Synced across devices'],
    ['PDF, Anki and Markdown export', 'Included', 'Included'],
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 pt-10 sm:pt-16 pb-8">
      <div className="max-w-2xl">
        <h1 className="text-4xl sm:text-5xl text-ink leading-[1.1]">Simple passes for exam season.</h1>
        <p className="mt-4 text-base sm:text-lg text-muted">
          Start free with no account. Pay only when you need more, and only for as long as you need it.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-3 text-sm text-ink">
        <button
          type="button"
          role="switch"
          aria-checked={showRegional}
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
        <span>
          Show regional student prices<span className="text-muted">*</span>
        </span>
      </div>

      {/* Plans */}
      <div className="mt-8 grid md:grid-cols-3 gap-5 items-stretch">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-lg bg-surface p-6 flex flex-col ${
              plan.featured ? 'border-2 border-ink' : 'border border-rule'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-sans text-base font-semibold text-ink">{plan.name}</h2>
              {plan.featured && <span className="text-xs font-semibold text-accent">Best value</span>}
            </div>
            <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="font-serif text-5xl text-ink tabular-nums">{showRegional ? plan.regional : plan.price}</span>
              <span className="text-sm text-muted">/ {plan.per}</span>
            </p>
            <p className="mt-1.5 text-sm text-ink">{plan.billing}</p>
            <p className="mt-4 pt-4 border-t border-rule text-sm text-muted">
              Everything in the paid column below, with {plan.upload}.
            </p>
            <button
              type="button"
              onClick={() => handleStartCheckout(plan.id)}
              className={`mt-6 w-full py-2.5 px-4 rounded-md text-sm font-semibold transition-colors ${
                plan.featured
                  ? 'bg-ink text-white hover:bg-ink/90'
                  : 'border border-ink text-ink hover:bg-ink hover:text-white'
              }`}
            >
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">
        *Regional pricing is offered automatically in Egypt, Turkey, India, Pakistan, Morocco, Indonesia and similar countries, and is confirmed against your billing country at checkout.
      </p>

      {/* Free vs paid */}
      <section aria-label="Compare free and paid" className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-3xl text-ink">Free and paid, side by side</h2>
          <Link to="/app" className="text-sm font-semibold text-accent hover:underline underline-offset-2">
            Use the free plan
          </Link>
        </div>
        <div className="mt-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Plan comparison table">
          <table className="w-full min-w-[34rem] text-left text-[15px]">
            <thead>
              <tr className="border-b border-ink text-sm">
                <th scope="col" className="py-3 pr-4 font-medium text-muted w-[40%]"><span className="sr-only">Feature</span></th>
                <th scope="col" className="py-3 pr-4 font-semibold text-ink">Free <span className="font-normal text-muted">· $0, no sign-up</span></th>
                <th scope="col" className="py-3 font-semibold text-ink">Any paid plan</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([feature, free, paid]) => (
                <tr key={feature} className="border-b border-rule">
                  <th scope="row" className="py-3 pr-4 font-normal text-ink">{feature}</th>
                  <td className="py-3 pr-4 text-muted">{free}</td>
                  <td className="py-3 text-ink">{paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Daily limits reset at 00:00 UTC.</p>
      </section>

      {/* Invite a friend */}
      <section aria-label="Invite a friend" className="mt-16 border-y border-rule py-8 grid md:grid-cols-12 gap-6 items-center">
        <div className="md:col-span-7">
          <h2 className="text-2xl sm:text-3xl text-ink">Invite a classmate, both get 3 days free.</h2>
          <p className="mt-2 text-[15px] text-muted leading-relaxed">
            Share your invite link. When your friend makes their first revision pack, you each get a 3-day Exam Pass.
            Up to 5 rewards per student.
          </p>
        </div>
        <div className="md:col-span-5">
          <form onSubmit={handleGenerateReferral}>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-md border border-ink text-ink text-sm font-semibold hover:bg-ink hover:text-white transition-colors"
            >
              Get my invite link
            </button>
          </form>
          {refCodeLink && (
            <div className="mt-3 p-2.5 rounded-md border border-rule bg-surface flex items-center justify-between gap-2 text-sm">
              <code className="font-mono text-xs text-ink truncate">{refCodeLink}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(refCodeLink);
                  setRefCopied(true);
                  setTimeout(() => setRefCopied(false), 2000);
                }}
                className="px-2.5 py-1 rounded-md bg-ink text-white text-xs font-semibold shrink-0"
              >
                {refCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Checkout Modal */}
      {checkoutPlan && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="w-full max-w-md rounded-lg bg-surface border border-rule p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 id="checkout-title" className="text-lg font-semibold text-ink">
                Continue to Checkout ({checkoutPlan.replace('_', ' ')})
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCheckoutPlan(null);
                  setCheckoutNotice(null);
                }}
                aria-label="Close checkout"
                className="text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Enter your email so your pass and magic-link deck sync are linked to your account immediately after payment.
            </p>
            <form onSubmit={handleConfirmCheckout} className="mt-4 space-y-3">
              <label htmlFor="checkout-email" className="sr-only">Email address</label>
              <input
                id="checkout-email"
                type="email"
                required
                autoFocus
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full px-3.5 py-2.5 rounded-md border border-rule text-sm text-ink"
              />
              <button
                type="submit"
                className="w-full py-3 rounded-md bg-accent text-white font-bold text-sm"
              >
                Proceed to Secure Payment
              </button>
            </form>
            {checkoutNotice && (
              <p className="mt-3 p-3 rounded-md bg-accent-soft text-accent text-xs font-semibold">
                {checkoutNotice}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
