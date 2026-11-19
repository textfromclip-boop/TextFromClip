// The paid-plan code paths, with the launch switch turned ON. Production currently runs in free
// launch mode (PAYMENTS_ENABLED = false); these tests make sure turning payments back on works.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../shared/launch', () => ({
  PAYMENTS_ENABLED: true,
  FREE_LAUNCH_BANNER: 'Free during launch. No account, no card.',
}));

import app from '../server/index';
import { resetMemoryQuotasAndCacheForTests } from '../server/utils/quotasAndCache';
import { resetMemoryAuthAndPaymentsForTests } from '../server/utils/paymentsAndAuth';
import { ROUTE_META } from '../seo/routeMeta';
import { formatUsd, PLANS } from '../shared/plans';

beforeEach(() => {
  resetMemoryQuotasAndCacheForTests();
  resetMemoryAuthAndPaymentsForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payments enabled', () => {
  const LS_ENV = {
    ENVIRONMENT: 'test',
    LEMONSQUEEZY_API_KEY: 'test_key',
    LEMONSQUEEZY_STORE_ID: '1234',
    LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec_test_0123456789',
    LEMONSQUEEZY_VARIANT_EXAM_PASS: '101',
    LEMONSQUEEZY_VARIANT_EXAM_PASS_REGIONAL: '102',
    LEMONSQUEEZY_VARIANT_MONTHLY: '201',
    LEMONSQUEEZY_VARIANT_MONTHLY_REGIONAL: '202',
    LEMONSQUEEZY_VARIANT_PREP_PASS: '301',
    LEMONSQUEEZY_VARIANT_PREP_PASS_REGIONAL: '302',
  } as any;

  it('checkout: creates a Lemon Squeezy checkout with the correct store + variant for every plan and region', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ data: { attributes: { url: 'https://learnfromclip.lemonsqueezy.com/checkout/custom/abc' } } }), { status: 201 });
    }));
    const cases: Array<[string, string, string]> = [
      ['exam_pass', 'US', '101'], ['exam_pass', 'EG', '102'],
      ['monthly', 'GB', '201'], ['monthly', 'IN', '202'],
      ['prep_pass', 'DE', '301'], ['prep_pass', 'TR', '302'],
    ];
    for (const [plan, country, variant] of cases) {
      const res = await app.request('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-IPCountry': country, 'x-forwarded-for': `10.8.${variant}.1` },
        body: JSON.stringify({ plan, email: 'buyer@uni.edu', billingCountry: 'EG' }), // body country is ignored
      }, LS_ENV);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data.checkoutUrl).toContain('lemonsqueezy.com');
      const last = calls[calls.length - 1];
      expect(last.url).toBe('https://api.lemonsqueezy.com/v1/checkouts');
      expect(last.init.headers.Authorization).toBe('Bearer test_key');
      expect(last.body.data.relationships.store.data.id).toBe('1234');
      expect(last.body.data.relationships.variant.data.id).toBe(variant);
      expect(last.body.data.attributes.checkout_data.custom.aid).toMatch(/^u_/);
    }
  });

  it('sitemap lists /pricing and /refund, and the pricing SEO text carries the real prices', async () => {
    const xml = await (await app.request('/sitemap.xml')).text();
    expect(xml).toContain('https://learnfromclip.com/pricing');
    expect(xml).toContain('https://learnfromclip.com/refund');
    expect(ROUTE_META['/pricing'].description).toContain(formatUsd(PLANS.prep_pass.priceUsd));
    expect(ROUTE_META['/pricing'].description).not.toMatch(/2\.99|14\.99|Semester/);
  });

  it('the daily-limit message points free students to the passes', async () => {
    const headers = { 'Content-Type': 'application/json', 'x-enforce-quota': '1', 'x-forwarded-for': '10.44.0.1' };
    const env = { ENVIRONMENT: 'test' } as any;
    const segs = (extra: string) =>
      Array.from({ length: 40 }, (_, i) => ({ id: i + 1, start: i * 10, duration: 10, text: `Enzymes are biological catalysts that speed up reactions point ${i + 1}${extra}.` }));
    const first = await app.request('/api/revision-pack', { method: 'POST', headers, body: JSON.stringify({ segments: segs(''), videoTitle: 'A' }) }, env);
    expect(first.status).toBe(200);
    const cookie = (first.headers.get('set-cookie') || '').match(/lfc_aid=[^;]+/)![0];
    const second = await app.request('/api/revision-pack', { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ segments: segs(' again'), videoTitle: 'B' }) }, env);
    expect(second.status).toBe(429);
    expect(((await second.json()) as any).error.message).toMatch(/Upgrade to an Exam Week or Exam Prep Pass/);
  });
});
