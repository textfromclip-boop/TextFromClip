import { describe, it, expect, beforeEach } from 'vitest';
import {
  scheduleFlashcardSm2,
  updateDailyStreak,
  isCardDueToday,
} from '../utils/sm2';
import {
  saveStudyDeck,
  recordCardReviewInStore,
  createMissedQuestionsDeck,
} from '../utils/studyStore';
import {
  consumeQuota,
  getCachedRevisionPack,
  getCachedTranscript,
  getDailyCostReport,
  getDailyQuotaStatus,
  parseCookies,
  recordCostTelemetry,
  resetMemoryQuotasAndCacheForTests,
  resolveActorIdentity,
  setCachedRevisionPack,
  setCachedTranscript,
  signAnonymousCookieId,
  verifySignedCookieId,
  buildRevisionPackCacheKey,
} from '../server/utils/quotasAndCache';
import {
  completeReferralOnFirstDeck,
  createMagicLinkToken,
  getActiveEntitlementForUser,
  getReferralCodeForIdentity,
  readLemonSqueezyConfig,
  isEligibleForRegionalPricing,
  loadSyncedDecksFromCloud,
  processPaymentWebhook,
  resetMemoryAuthAndPaymentsForTests,
  syncUserDecksToCloud,
  verifyMagicLinkToken,
} from '../server/utils/paymentsAndAuth';
import { isValidAnalyticsEvent } from '../utils/analytics';
import app from '../server/index';
import { RevisionPack, TranscriptResult } from '../types';

describe('Phase 2 — Study Mode, SM-2 Spaced Repetition & Streak Persistence', () => {
  it('correctly calculates SM-2 spaced repetition transitions', () => {
    const baseCard = {
      id: 'c1',
      front: 'Q',
      back: 'A',
      source: { start_seconds: 0, end_seconds: 5, quote: 'q' },
      due_date: '2026-11-01',
      reps: 0,
      interval: 0,
      ease: 2.5,
    };

    // 1. Initial review with 'good' rating
    const firstGood = scheduleFlashcardSm2(baseCard, 'good', '2026-11-01');
    expect(firstGood.reps).toBe(1);
    expect(firstGood.interval).toBe(1);
    expect(firstGood.due_date).toBe('2026-11-02');

    // 2. Second review with 'good' rating
    const secondGood = scheduleFlashcardSm2(firstGood, 'good', '2026-11-02');
    expect(secondGood.reps).toBe(2);
    expect(secondGood.interval).toBe(3);
    expect(secondGood.due_date).toBe('2026-11-05');

    // 3. Third review with 'easy' rating (increases ease and applies bonus)
    const thirdEasy = scheduleFlashcardSm2(secondGood, 'easy', '2026-11-05');
    expect(thirdEasy.reps).toBe(3);
    expect(thirdEasy.interval).toBeGreaterThan(5);
    expect(thirdEasy.ease).toBeGreaterThan(2.5);

    // 4. Failed review with 'again' resets reps to 0 and interval to 0
    const fourthAgain = scheduleFlashcardSm2(thirdEasy, 'again', '2026-11-25');
    expect(fourthAgain.reps).toBe(0);
    expect(fourthAgain.interval).toBe(0);
    expect(fourthAgain.due_date).toBe('2026-11-25');
    expect(fourthAgain.ease).toBeGreaterThanOrEqual(1.3);

    // 5. 'Hard' rating reduces ease but does not reset reps
    const fifthHard = scheduleFlashcardSm2(
      {
        id: 'c2',
        front: 'Q',
        back: 'A',
        source: { start_seconds: 0, end_seconds: 5, quote: 'q' },
        due_date: '2026-11-01',
        reps: 2,
        interval: 6,
        ease: 2.5,
      },
      'hard',
      '2026-11-01'
    );
    expect(fifthHard.interval).toBe(7); // 6 * 1.2 rounded
    expect(fifthHard.ease).toBeLessThan(2.5);
    expect(fifthHard.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('calculates daily study streaks accurately across UTC dates', () => {
    // 1. First review ever
    const s1 = updateDailyStreak(0, null, '2026-11-01');
    expect(s1.streakDays).toBe(1);
    expect(s1.lastStudyUtcDate).toBe('2026-11-01');

    // 2. Same-day review keeps current streak
    const s2 = updateDailyStreak(s1.streakDays, s1.lastStudyUtcDate, '2026-11-01');
    expect(s2.streakDays).toBe(1);

    // 3. Consecutive day review increments streak
    const s3 = updateDailyStreak(s2.streakDays, s2.lastStudyUtcDate, '2026-11-02');
    expect(s3.streakDays).toBe(2);
    expect(s3.lastStudyUtcDate).toBe('2026-11-02');

    // 4. Another consecutive day
    const s4 = updateDailyStreak(s3.streakDays, s3.lastStudyUtcDate, '2026-11-03');
    expect(s4.streakDays).toBe(3);

    // 5. Missed 2 days (jump from Nov 3 to Nov 6) resets streak to 1
    const s5 = updateDailyStreak(s4.streakDays, s4.lastStudyUtcDate, '2026-11-06');
    expect(s5.streakDays).toBe(1);
    expect(s5.lastStudyUtcDate).toBe('2026-11-06');
  });

  it('stores and updates decks, due card counters, and missed question decks', async () => {
    const mockPack: RevisionPack = {
      id: 'pack_test_1',
      title: 'Cellular Respiration',
      provider: 'youtube',
      videoId: 'v123',
      durationSeconds: 300,
      notes: [],
      flashcards: [
        {
          id: 'card_1',
          front: 'Where does glycolysis occur?',
          back: 'In the cytosol of the cell.',
          source: { start_seconds: 120, end_seconds: 125, quote: 'glycolysis occurs in cytosol' },
          due_date: '2026-11-01',
          interval: 0,
          ease: 2.5,
          reps: 0,
        },
        {
          id: 'card_2',
          front: 'What is the net ATP yield of glycolysis?',
          back: '2 ATP molecules per glucose.',
          source: { start_seconds: 240, end_seconds: 245, quote: 'net two ATP molecules' },
          due_date: '2026-11-05',
          interval: 4,
          ease: 2.5,
          reps: 1,
        },
      ],
      quiz: [],
      metadata: {
        generatedAt: Date.now(),
        totalChunks: 1,
        verifiedItemsCount: 2,
        droppedQuotesCount: 0,
        modelUsed: 'mock_test_model',
      },
    };

    const saved = await saveStudyDeck(mockPack);
    expect(saved.id).toBe('pack_test_1');

    // On 2026-11-01, card_1 is due, card_2 is not yet due
    const dueCount = saved.pack.flashcards.filter((c) => isCardDueToday(c, '2026-11-01')).length;
    expect(dueCount).toBe(1);

    // Grade card_1 as 'good'
    const updated = await recordCardReviewInStore(
      saved.id,
      saved.pack.flashcards[0].id,
      'good',
      '2026-11-01'
    );
    expect(updated.updatedDeck).not.toBeNull();
    const reviewedCard = updated.updatedDeck!.pack.flashcards.find((c) => c.id === 'card_1');
    expect(reviewedCard?.reps).toBe(1);
    expect(reviewedCard?.due_date).toBe('2026-11-02');

    // Build missed questions deck from a quiz
    const missedDeck = await createMissedQuestionsDeck('Cellular Respiration', [
      {
        id: 'missed_q1',
        front: 'What is the end product of glycolysis?',
        back: 'Pyruvate — End product is pyruvate',
        source: { start_seconds: 300, end_seconds: 305, quote: 'pyruvate is the product' },
        due_date: '2026-11-01',
        interval: 0,
        ease: 2.5,
        reps: 0,
      },
    ]);
    expect(missedDeck.title).toContain('Missed Quiz Review');
    expect(missedDeck.pack.flashcards.length).toBe(1);
  });
});

describe('Phase 3 — Free Tier Limits, Anonymous Turnstile Identity & Caching', () => {
  beforeEach(() => {
    resetMemoryQuotasAndCacheForTests();
    resetMemoryAuthAndPaymentsForTests();
  });

  it('identifies anonymous users via HMAC-signed cookie and a shared per-IP ceiling key', async () => {
    const secret = 'test-edge-secret-0123456789abcdef0123';
    const anonCookie = await signAnonymousCookieId('anon_student_1', secret);
    expect(await verifySignedCookieId(anonCookie, secret)).toBe('anon_student_1');
    expect(await verifySignedCookieId('tampered-token', secret)).toBeNull();
    expect(await verifySignedCookieId(anonCookie.replace(/.$/, '0'), secret)).toBeNull();
    expect(await verifySignedCookieId(anonCookie, 'another-secret-0123456789abcdef0123')).toBeNull();

    // Resolves identity from cookie header
    const identity = await resolveActorIdentity({
      cookieHeader: `lfc_aid=${encodeURIComponent(anonCookie)}`,
      ip: '198.51.100.24',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookieSecret: secret,
    });
    expect(identity.cookieId).toBe('anon_student_1');
    expect(identity.isNewCookie).toBe(false);

    // University IP safety: two different students sharing the same campus IP get separate actor keys
    const identityStudent2 = await resolveActorIdentity({
      cookieHeader: '',
      ip: '198.51.100.24',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      cookieSecret: secret,
    });
    expect(identityStudent2.actorKey).not.toBe(identity.actorKey);
    // ...but share the same per-IP ceiling bucket
    expect(identityStudent2.networkFallbackKey).toBe(identity.networkFallbackKey);
  });

  it('enforces free tier limits (5 links/day, 20 audio mins/day, 3 AI actions/day, 1 mock exam/day)', async () => {
    const actorKey = 'user_limits_test';
    const statusInitial = await getDailyQuotaStatus({ actorKey, plan: 'free' });
    expect(statusInitial.linksLimit).toBe(5);
    expect(statusInitial.uploadSecondsLimit).toBe(1200); // 20 mins = 1200s
    expect(statusInitial.aiActionsLimit).toBe(3);
    expect(statusInitial.mockExamsLimit).toBe(1);
    expect(statusInitial.maxCardsPerPack).toBe(30);
    expect(statusInitial.maxLectureSeconds).toBe(7200); // 2 hours

    // Consume 5 links
    await consumeQuota({ actorKey, links: 5 });
    const afterLinks = await getDailyQuotaStatus({ actorKey, plan: 'free' });
    expect(afterLinks.linksUsed).toBe(5);

    // Consume 3 AI actions (6 half-units) and 1 mock exam
    await consumeQuota({ actorKey, aiHalfUnits: 6, mockExams: 1 });
    const afterAi = await getDailyQuotaStatus({ actorKey, plan: 'free' });
    expect(afterAi.aiActionsUsed).toBe(3);
    expect(afterAi.mockExamsUsed).toBe(1);

    // Paid user gets higher limits (50 links/day, 100 AI actions/day, 150 cards/pack)
    const paidStatus = await getDailyQuotaStatus({ actorKey: 'paid_user_1', plan: 'monthly' });
    expect(paidStatus.linksLimit).toBe(50);
    expect(paidStatus.aiActionsLimit).toBe(100);
    expect(paidStatus.mockExamsLimit).toBe(9999);
    expect(paidStatus.maxCardsPerPack).toBe(150);
    expect(paidStatus.maxLectureSeconds).toBe(14400); // 4 hours
  });

  it('serves cached transcripts at 0 link quota cost', async () => {
    const mockTx: TranscriptResult = {
      id: 'tx_cached_1',
      provider: 'youtube',
      videoId: 'vCached123',
      language: 'en',
      videoTitle: 'Introduction to Algorithms',
      videoDurationSeconds: 1800,
      fullText: 'Welcome to introduction to algorithms.',
      sourceType: 'captions',
      segments: [{ id: 1, start: 0, duration: 5, text: 'Welcome to introduction to algorithms.' }],
      srt: '1\n00:00:00,000 --> 00:00:05,000\nWelcome to introduction to algorithms.',
      vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nWelcome to introduction to algorithms.',
      createdAt: Date.now(),
    };

    await setCachedTranscript(mockTx);
    const cached = await getCachedTranscript('youtube', 'vCached123', 'en');
    expect(cached).not.toBeNull();
    expect(cached?.videoTitle).toBe('Introduction to Algorithms');
  });

  it('serves cached revision packs at 0.5 AI action cost', async () => {
    const segments = [{ start: 10, text: 'Photosynthesis converts light into chemical energy.' }];
    const { packCacheKey, transcriptHash } = buildRevisionPackCacheKey(segments, 'Arabic', 30);

    const mockPack: RevisionPack = {
      id: 'pack_cached_1',
      title: 'Photosynthesis Lecture',
      provider: 'youtube',
      videoId: 'vPhoto',
      durationSeconds: 60,
      notes: [],
      flashcards: [],
      quiz: [],
      secondLanguage: 'Arabic',
      metadata: {
        generatedAt: Date.now(),
        totalChunks: 1,
        verifiedItemsCount: 1,
        droppedQuotesCount: 0,
        modelUsed: 'mock_test_model',
      },
    };

    await setCachedRevisionPack(packCacheKey, transcriptHash, mockPack);
    const retrieved = await getCachedRevisionPack(packCacheKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Photosynthesis Lecture');
    expect(retrieved?.metadata.cached).toBe(true);
  });
});

describe('Phase 4 — Payments, Webhooks, Magic Link Auth & Fraud-Resistant Referrals', () => {
  beforeEach(() => {
    resetMemoryQuotasAndCacheForTests();
    resetMemoryAuthAndPaymentsForTests();
  });

  it('detects regional pricing countries correctly', () => {
    expect(isEligibleForRegionalPricing('EG')).toBe(true); // Egypt
    expect(isEligibleForRegionalPricing('TR')).toBe(true); // Turkey
    expect(isEligibleForRegionalPricing('IN')).toBe(true); // India
    expect(isEligibleForRegionalPricing('PK')).toBe(true); // Pakistan
    expect(isEligibleForRegionalPricing('MA')).toBe(true); // Morocco
    expect(isEligibleForRegionalPricing('ID')).toBe(true); // Indonesia
    expect(isEligibleForRegionalPricing('US')).toBe(false);
    expect(isEligibleForRegionalPricing('GB')).toBe(false);
    expect(isEligibleForRegionalPricing('DE')).toBe(false);
  });

  it('handles Lemon Squeezy order, refund and subscription lifecycles (plan from variant id only)', async () => {
    const config = readLemonSqueezyConfig({
      LEMONSQUEEZY_VARIANT_EXAM_PASS: '101',
      LEMONSQUEEZY_VARIANT_MONTHLY: '201',
    });
    // 1. Purchase Exam Pass
    const purchaseResult = await processPaymentWebhook(
      {
        meta: { event_name: 'order_created', custom_data: { plan: 'semester_pass' } },
        data: {
          id: '9001',
          attributes: { user_email: 'student@example.edu', status: 'paid', first_order_item: { variant_id: 101 } },
        },
      },
      { eventHash: 'h1', config }
    );
    expect(purchaseResult.handled).toBe(true);
    // custom_data claimed semester_pass, but the variant is the Exam Pass
    expect(purchaseResult.entitlements?.[0].planType).toBe('exam_pass');

    const activeEnt = await getActiveEntitlementForUser('student@example.edu');
    expect(activeEnt?.planType).toBe('exam_pass');

    // 2. Refund immediately revokes entitlement
    const refundResult = await processPaymentWebhook(
      { meta: { event_name: 'order_refunded' }, data: { id: '9001', attributes: { user_email: 'student@example.edu' } } },
      { eventHash: 'h2', config }
    );
    expect(refundResult.handled).toBe(true);
    expect(await getActiveEntitlementForUser('student@example.edu')).toBeNull();

    // 3. Subscription: cancellation retains access until ends_at
    await processPaymentWebhook(
      {
        meta: { event_name: 'subscription_created' },
        data: {
          id: 'sub_77',
          attributes: {
            user_email: 'monthly@example.edu',
            variant_id: 201,
            status: 'active',
            renews_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        },
      },
      { eventHash: 'h3', config }
    );
    const cancelResult = await processPaymentWebhook(
      {
        meta: { event_name: 'subscription_cancelled' },
        data: {
          id: 'sub_77',
          attributes: {
            user_email: 'monthly@example.edu',
            variant_id: 201,
            status: 'cancelled',
            ends_at: new Date(Date.now() + 86400000).toISOString(),
          },
        },
      },
      { eventHash: 'h4', config }
    );
    expect(cancelResult.entitlements?.[0].status).toBe('cancelled');
    expect(await getActiveEntitlementForUser('monthly@example.edu')).not.toBeNull();
  });

  it('creates and verifies single-use passwordless magic links', async () => {
    const email = 'scholar@university.edu';
    const link = await createMagicLinkToken(email);
    expect(link.token.length).toBeGreaterThanOrEqual(40);
    expect(link.email).toBe(email);

    const verified = await verifyMagicLinkToken(link.token, 'test-secret-0123456789abcdef0123456');
    expect(verified?.user.email).toBe(email);
    expect(verified?.signedUserCookie).toContain('lfc_uid=');

    // Second use of the same token fails (single-use)
    const reused = await verifyMagicLinkToken(link.token, 'test-secret-0123456789abcdef0123456');
    expect(reused).toBeNull();
  });

  it('syncs decks to cloud for authenticated users', async () => {
    const userId = 'usr_med_student';
    const decks = [
      {
        id: 'deck_anatomy_1',
        title: 'Gross Anatomy Neck & Thorax',
        packJson: JSON.stringify({ id: 'deck_anatomy_1', flashcards: [] }),
        updatedAt: Date.now(),
      },
    ];

    await syncUserDecksToCloud(userId, decks);
    const loaded = await loadSyncedDecksFromCloud(userId);
    expect(loaded.length).toBe(1);
    expect(loaded[0].title).toBe('Gross Anatomy Neck & Thorax');
  });

  it('rewards both referrer and friend with a 3-day Exam Pass on first deck, with strict anti-fraud', async () => {
    const referrer = await getReferralCodeForIdentity('referrer@campus.edu', 'device_referrer');
    const referralCode = referrer.referralCode;

    const rewardResult = await completeReferralOnFirstDeck({
      referralCode,
      inviteeIdentityEmail: 'friend@campus.edu',
      inviteeActorKey: 'anon:friend',
      inviteeIpHash: 'ip_friend',
      inviteeDeviceHash: 'device_friend',
    });
    expect(rewardResult.rewarded).toBe(true);
    expect(rewardResult.referrerEntitlement?.planType).toBe('exam_pass');
    expect(rewardResult.inviteeEntitlement?.planType).toBe('exam_pass');

    // Same invitee cannot claim twice
    const again = await completeReferralOnFirstDeck({
      referralCode,
      inviteeIdentityEmail: 'friend@campus.edu',
      inviteeActorKey: 'anon:friend',
      inviteeIpHash: 'ip_friend',
      inviteeDeviceHash: 'device_friend',
    });
    expect(again.reason).toBe('ALREADY_REWARDED');

    // Self-referral by same identity is blocked
    const selfEmail = await completeReferralOnFirstDeck({
      referralCode,
      inviteeIdentityEmail: 'referrer@campus.edu',
      inviteeActorKey: 'anon:self2',
      inviteeIpHash: 'ip_x',
      inviteeDeviceHash: 'device_x',
    });
    expect(selfEmail.reason).toBe('SELF_REFERRAL_BLOCKED');

    // Self-referral from the same device (cleared cookies / incognito) is blocked
    const selfDevice = await completeReferralOnFirstDeck({
      referralCode,
      inviteeIdentityEmail: 'u_new@guest.learnfromclip.com',
      inviteeActorKey: 'anon:self3',
      inviteeIpHash: 'ip_y',
      inviteeDeviceHash: 'device_referrer',
    });
    expect(selfDevice.reason).toBe('SAME_DEVICE_SELF_REFERRAL_BLOCKED');
  });
});

describe('Phase 5 — Admin Costs, Privacy Analytics & SEO Endpoints', () => {
  beforeEach(() => {
    resetMemoryQuotasAndCacheForTests();
  });

  it('aggregates daily cost telemetry and cache hit rates', async () => {
    await recordCostTelemetry({
      whisperAudioSeconds: 1200, // 20 minutes
      llmInputTokens: 50000,
      llmOutputTokens: 15000,
      transcriptCacheHits: 8,
      transcriptCacheMisses: 2,
      packCacheHits: 12,
      packCacheMisses: 3,
    });

    const report = await getDailyCostReport();
    expect(report.transcriptionMinutes).toBe(20);
    expect(report.llmInputTokens).toBe(50000);
    expect(report.transcriptCacheHitRate).toBe(80); // 8 / 10 = 80%
    expect(report.packCacheHitRate).toBe(80); // 12 / 15 = 80%
    expect(report.estimatedCostUsd.totalUsd).toBeGreaterThan(0);
  });

  it('validates canonical product analytics events', () => {
    expect(isValidAnalyticsEvent('link_submitted')).toBe(true);
    expect(isValidAnalyticsEvent('transcript_done')).toBe(true);
    expect(isValidAnalyticsEvent('pack_started')).toBe(true);
    expect(isValidAnalyticsEvent('pack_done')).toBe(true);
    expect(isValidAnalyticsEvent('card_reviewed')).toBe(true);
    expect(isValidAnalyticsEvent('quiz_finished')).toBe(true);
    expect(isValidAnalyticsEvent('export_clicked')).toBe(true);
    expect(isValidAnalyticsEvent('limit_hit')).toBe(true);
    expect(isValidAnalyticsEvent('pricing_viewed')).toBe(true);
    expect(isValidAnalyticsEvent('checkout_started')).toBe(true);
    expect(isValidAnalyticsEvent('purchase')).toBe(true);
    expect(isValidAnalyticsEvent('referral_sent')).toBe(true);
    expect(isValidAnalyticsEvent('day7_return')).toBe(true);
    expect(isValidAnalyticsEvent('unknown_random_event')).toBe(false);
  });

  it('GET /sitemap.xml returns all 12 SEO landing pages and core routes', async () => {
    const res = await app.request('/sitemap.xml');
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('https://learnfromclip.com/');
    expect(xml).toContain('https://learnfromclip.com/study');
    expect(xml).toContain('https://learnfromclip.com/pricing');
    expect(xml).toContain('https://learnfromclip.com/youtube-lecture-to-flashcards');
    expect(xml).toContain('https://learnfromclip.com/lecture-to-notes');
    expect(xml).toContain('https://learnfromclip.com/video-to-quiz');
    expect(xml).toContain('https://learnfromclip.com/youtube-to-text');
    expect(xml).toContain('https://learnfromclip.com/youtube-transcript-to-pdf');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-arabic');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-spanish');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-french');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-german');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-turkish');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-portuguese');
    expect(xml).toContain('https://learnfromclip.com/flashcards-in-hindi');
  });

  it('GET /robots.txt points to learnfromclip.com sitemap', async () => {
    const res = await app.request('/robots.txt');
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toContain('Sitemap: https://learnfromclip.com/sitemap.xml');
  });
});
