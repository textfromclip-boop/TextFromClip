# LearnFromClip — Launch Audit Report

**Date:** 2026-11-09 · **Branch:** `audit/learnfromclip` (not merged, not deployed)
**Scope:** independent verification of the TextFromClip → LearnFromClip transformation against the launch spec.

## TL;DR

Gemini's report ("all five phases done, 134/134 tests, clean build") was **true about the tests and build, but the tests did not test the right things**. Several of them asserted insecure behaviour as correct. I found **8 critical/security bugs** (anyone could grant themselves a paid plan, log in as anyone, read admin costs, or claim paid limits with a request flag), several broken user flows (every *Buy* button and the referral box were broken, uploads were silently cut at 30 minutes, "Review what you missed" deleted the student's deck), and **no real payment or email integration at all**.

All of these are fixed on this branch, with **49 new unit/API tests** (183/183 passing) and a **62-check Playwright end-to-end run** at 1920×1080 and 375 px against the real API and a real local D1 database (62/62 passing). Lighthouse on the homepage: **mobile 98, desktop 99** performance, 100 accessibility / best practices / SEO.

**Ready to launch?** Not yet. The code is ready for a staging run, but nothing that costs money or sends email can work until you configure the secrets in §4, and three things could not be tested from my sandbox (live YouTube/TikTok/Instagram fetching, the real Workers AI model, a real Lemon Squeezy test purchase). See §5.

---

## Step 1 — Baseline (before any change)

| Command | Result |
|---|---|
| `npm ci` | OK |
| `npm run test` | 134/134 passed (15 files) |
| `npx tsc --noEmit` | clean |
| `npm run build` | OK (also builds the Pages bundle, see note) |
| `npm run build:pages` | OK (`build:pages` is just an alias of `build`) |
| `wrangler d1 migrations apply DB --local` (fresh DB) | 0001 + 0002 applied cleanly |

**After the audit:** `npm run test` **183/183**, `tsc` clean, `build` clean, migrations 0001–0003 apply cleanly to a fresh DB **and** to a DB that already has users/decks/entitlements (0003 rebuilds `synced_decks` and keeps existing rows).

### What Gemini added (commit `77817ad`)

New server modules: `quotasAndCache.ts`, `paymentsAndAuth.ts`, `revisionPackGenerator.ts`; new UI: `RevisionPackView`, `StudyPage`, `PricingPage`, `LegalPages`, `SeoPagesAndHome`; utils `sm2.ts`, `studyStore.ts`, `packExporters.ts`, `analytics.ts`; migration `0002`.
New endpoints: `GET /api/usage`, `POST /api/revision-pack`, `POST /api/auth/magic-link`, `GET /api/auth/verify`, `GET|POST /api/decks/sync`, `POST /api/checkout`, `POST /api/webhooks/lemonsqueezy`, `POST /api/referral/code`, `POST /api/referral/complete`, `GET /api/admin/costs`, `POST /api/events`, plus a `textfromclip.com` redirect middleware.
Later commits (`2c6140f`, `08be0bd`) switched the D1/R2 bindings to `learnfromclip-db` and then **back** to `textfromclip-db` (see §4, D1).

### Leftover "TextFromClip" text

No user-facing leftovers in UI, meta tags, manifest, legal pages, sitemap or emails. Remaining (internal, not user-facing): Cloudflare project/DB/bucket names in `wrangler*.toml` (`textfromclip`, `textfromclip-db`, `textfromclip-uploads`), the README, and a legacy localStorage key used to migrate old history. `package.json` name was changed to `learnfromclip`. The homepage referenced a non-existent `og-image.png` (removed; add a real one later if you want a large social card).

---

## Step 2 — Spec checklist

Legend: **PASS** works as specified · **FIXED** was broken/missing, fixed on this branch · **FAIL** not fixed (reason given) · **NEEDS CONFIG** code is ready, needs your keys/settings. "(mocked)" = verified with the external service mocked; see §5 for what still needs a live check.

### Brand
| Item | Status | Notes |
|---|---|---|
| Name LearnFromClip / learnfromclip.com everywhere user-facing | PASS | Only internal infra names remain (see above). |
| Logo icon unchanged; wordmark "LearnFrom" navy + "Clip" gradient | PASS | Icon shape identical. Gemini nudged the gradient stops (`#0F8CFA/#2868F7/#5131ED` → `#1287FA/#2E62F4/#4835F0`); revert in `Logo.tsx` if you want the exact old colours. |
| Headline "2-hour lecture → 10-minute revision pack." + sub-headline | PASS | Checked in E2E at both viewports. |

### Existing tools (regression)
| Item | Status | Notes |
|---|---|---|
| YouTube link → timestamped transcript | PASS (mocked) | E2E uses seeded captions; YouTube is not reachable from the sandbox. Provider unit tests pass. |
| TikTok / Instagram links | PASS (mocked) | Provider unit tests only. Needs a live check. |
| File upload ≤ 200 MB → transcript | **FIXED** | Uploads were silently cut to the **first 30 minutes** (10 × 3-min chunks) while quota was charged for the full length. Now uploaded and transcribed in 30-min batches up to 4 h. Verified E2E with a real WAV file (mocked Whisper). |
| Transcript edit, search, timestamp toggle, copy | PASS | `e2e/regression.mjs`; edited text is used in exports. |
| Translation (AR, ES, FR, DE, TR, PT, HI) | PASS (mocked) | All 7 listed; request succeeds; costs 1 AI action. |
| Export TXT / SRT / VTT | PASS | Files downloaded and checked. |
| AI formats | PASS (mocked) | Summary/script/blog/thread/notes. |

### Revision pack
| Item | Status | Notes |
|---|---|---|
| "Make my revision pack" → notes, flashcards, 10-question quiz | PASS | E2E: 22 note points · 30 cards · 10 questions. |
| Long lectures chunked by time, merged without duplicates | **FIXED** | Lectures over ~54 min only had **6 sampled windows** sent to the model; the rest was never read. Windows now grow so ≤ 6 windows cover the whole lecture (test: every segment of a 2-h lecture is sent). Merge is round-robin across windows and de-duplicated (test). |
| Every item has `source {start_seconds, end_seconds, quote}` and is verified | **FIXED** | A real quote cited at the **wrong timestamp was accepted** (the verifier fell back to searching the whole transcript). Two-word quotes like "of the" verified anything. Now: quote must be ≥ 3–4 words and found within 90 s of the cited time; anchor snaps to the exact caption line. |
| Tests: fabricated quote, wrong timestamp, punctuation/case, invalid JSON | PASS | All added in `audit-launch.test.ts`. **Also FIXED:** output cap was 3,200 tokens (30 cards + quiz + notes don't fit), and truncated JSON was thrown away; budget now scales and truncated JSON is repaired. |
| Filter doesn't drop almost everything on a normal lecture | PASS (simulated) | With realistic variance (case, punctuation, ±60 s timestamps, quotes spanning 2 lines) ≥ 90 % kept, fakes dropped. **Must be confirmed with the real model** (§5). Also fixed: every pack was padded to 30 with template "What key point is stated at 03:12…" cards; template items are now only used if the model returns too little. |
| "AI explanation" separate field, visually labelled | PASS | Separate field in UI, PDF, CSV, Markdown. Fixed bidi so Arabic explanations render correctly next to the English label. |
| "From lecture · MM:SS" seeks YouTube embed / uploaded media | PASS | E2E: 3 badges → `start=0/750/1762`; uploaded file → `<video>.currentTime` = 10 s. |
| Bilingual cards, Arabic RTL (`dir="auto"`) | PASS / **FIXED** | RTL renders correctly. The `/flashcards-in-<language>` pages didn't preselect the language they advertise; now they do. |

### Study mode
| Item | Status | Notes |
|---|---|---|
| SM-2 Again/Hard/Good/Easy (unit-tested maths) | PASS / **FIXED** | Maths correct (tests incl. month/year boundary). The buttons showed fixed hints "<10m / 1d / 3d / 7d" that **didn't match** what SM-2 schedules (new card: Good = 1 d, Easy = 4 d, Again = today); they now show the real interval. |
| Due cards, streak across days (UTC), progress per deck | PASS | E2E: 5 reviewed → 25 due after reload; streak tests. |
| Quiz → score → "Review what you missed" builds a deck | **FIXED** | The missed deck was saved under the lecture's video id, which **overwrote the student's original deck** with only the missed cards. Inline reviews also went to the wrong deck id after regenerating. |
| Free decks in IndexedDB (localStorage fallback) survive reload | PASS | E2E reload at both viewports. |

### Export
| Item | Status | Notes |
|---|---|---|
| PDF (notes + cards + quiz) renders Arabic | PASS / **FIXED** | Verified real Arabic shaping and RTL in Chromium print (`audit/screenshots/other/arabic-export-print.png`). Print now waits for web fonts (could print with fallback font). PDF is browser print-to-PDF, not a generated file. |
| Anki CSV (front, back, source timestamp), RFC-4180 escaping | PASS | Parsed back in tests with quotes, commas, newlines, Arabic; UTF-8 BOM. |
| Markdown export | PASS | |

### Limits and cost protection
| Item | Status | Notes |
|---|---|---|
| Free/paid numbers (5 links, 20 min, 3 AI, 30 cards, 1 quiz, 2 h / 50, 10 h/wk or 30 h/mo, 100, 150, ∞, 4 h) | **FIXED** | Daily numbers were right, but paid upload hours were enforced **per day** (10 h/day) instead of per rolling week/month. |
| Enforced server-side only | **FIXED** | `/api/revision-pack` trusted `body.isPaid` — any free user could get 150-card packs and skip the quiz limit. |
| Reset 00:00 UTC | PASS | Test. |
| UI shows remaining usage + upgrade button | **FIXED** | Navbar showed remaining AI actions; there was no upgrade button when a limit was hit. Added. |
| Anonymous identity: signed cookie + IP + Turnstile | **FIXED** / NEEDS CONFIG | Cookies were "signed" with a 32-bit FNV hash and a **hard-coded default secret** (forgeable, including the login cookie). Now HMAC-SHA256; production refuses to run without `COOKIE_SECRET`. Turnstile was checked on one route but **no widget existed in the UI**, so turning it on would have blocked every user; now an invisible challenge runs when the server asks, then a 24 h cookie. |
| Clearing cookies ≠ unlimited free AI | **FIXED** | Old fallback bucket was IP+user-agent: it stopped cookie clearing on one browser but **blocked classmates using the same browser on campus Wi-Fi**. Now: per-student limits + a shared per-IP ceiling (30 AI actions, 50 links, 200 upload min, 10 quizzes per day; IPv6 per /64; env-tunable). Tests: 20 cleared-cookie identities on one IP get exactly 30 actions; 10 students on one IP each get their full 3. |
| Caching: same video = no link quota; same pack = ½ AI action | PASS | Tests + E2E. Note: a cached pack also counts as the free user's 1 quiz/day. |
| Concurrency limit; per-IP burst limits on API routes | **FIXED** | Burst limits covered only 5 routes and were per-isolate memory (D1 was written but never read). Now every `/api/*` route has a bucket, shared across isolates via D1; auth routes 5/min. Quotas are reserved atomically (no double-spend under parallel requests). Job concurrency (6) is still **per isolate** — see §3. |
| `/api/admin/costs` requires auth | **FIXED** | Was public. Now `Authorization: Bearer $ADMIN_TOKEN`; stranger → 401, token not configured → 403 (tested). |

### Accounts and payments
| Item | Status | Notes |
|---|---|---|
| Magic link: single-use, 15 min, unguessable | **FIXED** | **Which service sends the email? None.** The API returned the login URL in its JSON response for any email address — anyone could sign in as anyone. Now: 256-bit tokens, stored as SHA-256, consumed atomically, link never in the response in production, link built from `APP_BASE_URL` (not the Host header), GET shows a "Sign in" button so email scanners can't burn the token. |
| Email provider | NEEDS CONFIG | Added Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Without it: production returns a clear 503; development logs the link and shows it on /study. |
| Cloud deck sync for paid users only; own decks only | **FIXED** | Was available to any signed-in user; a global deck id let one user **overwrite another user's deck**; and the UI never called sync at all. Now paid-only, keyed by (user, deck), wired into /study (tests: Alice and Bob with the same deck id stay separate; forged cookie → 401). |
| Lemon Squeezy checkout creation (store, variants per plan + regional, API key) | **FIXED** / NEEDS CONFIG | There was **no checkout creation** — `/api/checkout` returned a made-up URL, and the UI sent `planType` while the API read `plan`, so **every Buy button failed**. Now creates a real checkout via the LS API with the right store/variant for each plan × region (tested for all 6). |
| Webhooks: signature, idempotent, purchase, subscription lifecycle, refunds, passes expire, no auto-renew | **FIXED** | **Unsigned webhooks were accepted when the secret was unset** (free paid plans for anyone). Plan was read from `custom_data`/variant name, which buyers can set in the checkout URL. Duplicate deliveries extended passes; refunds revoked only one of several rows; `subscription_updated` always set "active". All fixed and tested (incl. replay 3 days later does not extend; refunded stays revoked). |
| Regional price validated against billing country | **FIXED** / NEEDS CONFIG | Was decided by `CF-IPCountry` **or a country sent in the request body**. Now offered by IP country and validated in the webhook against the customer's billing country from the LS API; mismatch → access withheld + logged for refund. |
| Referral: 3-day Exam Pass both, first deck, max 5, no self-referral | **FIXED** | Referral completion was never called by the UI, the referrer's IP/cookie came from the request body, state lived in isolate memory, and the Pricing referral box read the wrong field so it never showed a link. Now completed server-side when the invited student generates their first pack; D1-backed; max 5 enforced atomically; self-referral blocked by identity and device; ≤ 3 claims per network per 30 days. |

### Pages, SEO, legal, analytics
| Item | Status | Notes |
|---|---|---|
| Routes work on direct load + refresh (24 routes) | PASS | E2E. Unknown routes fall back to the app. |
| Each SEO page has a working tool, unique title/description, canonical | **FIXED** | Tool: PASS. But every route served the homepage title/description and no canonical. Build now writes one HTML file per route with unique tags; the router updates them on navigation (24/24 unique, tested). |
| sitemap.xml, robots.txt | PASS | |
| Privacy matches reality | **FIXED** | Now states what paid accounts store, names Lemon Squeezy and Resend, hashed IPs. Please review. |
| Terms include refund policy | **FIXED** | There was no refund policy. Added a 14-day refund policy and Lemon Squeezy as Merchant of Record. **This is my draft — you must confirm the terms you want.** |
| Analytics: 13 events, no personal data | **FIXED** | `purchase` never fired; /study reviews, quiz and exports fired nothing; upload limit errors didn't fire `limit_hit`. Payload is `{event, path}` only (tested); server stores event, path, plan, time. |
| textfromclip.com redirect | **FIXED** | Removed. |
| D1 migration names / DB name vs wrangler.toml | **FIXED** / NEEDS DECISION | `d1:migrate:*` scripts ran **only 0001** (never the LearnFromClip schema); now `wrangler d1 migrations apply DB`. Which database is production is unclear — see §4. |

### Accessibility & performance
| Item | Status | Notes |
|---|---|---|
| axe-core WCAG 2 A/AA: home, pricing, study, privacy, upload, SEO page, transcript, pack (notes/cards/quiz), checkout dialog, at 1920 and 375 | PASS / **FIXED** | One real contrast failure (SM-2 "Again" hint 4.41:1) fixed; dialogs got labels, `aria-modal` and named close buttons. Focus outline visible. |
| Lighthouse homepage ≥ 90 | PASS | Mobile 98, desktop 99 (with gzip as Cloudflare serves it; 87 uncompressed). Google Fonts were blocked in the sandbox, so real FCP may be slightly higher. Reports in `audit/`. |

---

## Bugs fixed (commits)

| Commit | What |
|---|---|
| [`ef00a90`](https://github.com/textfromclip-boop/TextFromClip/commit/ef00a90) | Remove textfromclip.com redirect; migration scripts apply all migrations. |
| [`6ba5104`](https://github.com/textfromclip-boop/TextFromClip/commit/6ba5104) | Security: webhook fail-closed + HMAC + idempotency; plan from variant id; refunds; real LS checkout; billing-country validation; `isPaid` removed from client; magic link (crypto tokens, Resend, no link leak); HMAC cookies + required secret; admin auth; paid-only, owner-scoped deck sync; D1-backed referrals; per-IP ceiling; atomic reservations; rolling paid upload windows; burst limits everywhere; Turnstile gate. Migration `0003`. |
| [`5888bc4`](https://github.com/textfromclip-boop/TextFromClip/commit/5888bc4) | Accuracy: strict near-timestamp verification, min quote length, JSON repair, full-lecture coverage, no template padding, round-robin merge. Race-free quota reservation. 49 new tests. |
| [`820b8fb`](https://github.com/textfromclip-boop/TextFromClip/commit/820b8fb) | Frontend: Buy buttons, referral box, ?ref capture, cloud sync UI, missed-deck overwrite, long uploads, Turnstile client, upgrade button, `purchase` event, per-route SEO HTML, PDF font wait, Terms/Privacy, dialog a11y. |
| [`f851df9`](https://github.com/textfromclip-boop/TextFromClip/commit/f851df9) | Real SM-2 interval hints; bilingual SEO pages preselect language; bidi fix; E2E harness. |
| [`187c7a9`](https://github.com/textfromclip-boop/TextFromClip/commit/187c7a9) | Contrast fix; /study analytics; regression E2E. |

## Merge with `main` (`216ea99`)

While the audit ran, `main` gained `216ea99` (refund page, Turnstile widget, webhook idempotency, Worker/Pages configs). It is merged into this branch:
- **Kept from main:** `/refund` page and Terms structure, `TurnstileWidget` (works with the server's Turnstile gate).
- **Deploy fix:** main's change of `wrangler.toml` into a Worker config made Cloudflare Pages ignore it and fall back to the dashboard output dir `..\dist-pages`, so the production build of `216ea99` **failed** (live site still on `0295576`). `wrangler.toml` is the Pages config again, the Worker config is `wrangler.worker.toml` (`npm run deploy`); preview build of this branch succeeds.
- **Replaced:** main's webhook de-duplication keyed on `data.id`, which would drop legitimate later `subscription_updated` events for the same subscription; this branch de-duplicates by the hash of each delivery. The `processed_webhooks` table main added to 0002 is harmless but unused. Privacy text claiming decks *and streaks* sync to "encrypted R2 storage" was corrected (decks sync to D1; streaks stay on the device). Migration scripts use `wrangler d1 migrations apply` instead of executing a single file.
- **Added:** SEO metadata + sitemap entry for `/refund`; `.env.example` now uses the variable names the code actually reads (it had `LEMON_SQUEEZY_*` and an unused `MAGIC_LINK_SECRET`).
- After the merge: 183/183 tests, 62/62 E2E checks.

## How to re-run the checks

```bash
npm run test
```
```bash
./e2e/run-all.sh
```
`run-all.sh` builds, creates a fresh local D1 with all migrations, starts `e2e/server.mjs` (real API + real local D1/R2; only Workers AI and YouTube captions are mocked) and runs `e2e/walkthrough.mjs` (1920 + 375), `e2e/checks.mjs` and `e2e/regression.mjs`. Screenshots of every step from the final run are in `audit/screenshots/`; results in `audit/e2e-results.json`.

---

## 3. Security and cost risks still open

1. **Not tested live (sandbox has no access):** YouTube/TikTok/Instagram fetching, the real Workers AI model (quality and how many items the verifier drops), real Whisper, a real Lemon Squeezy test purchase/refund, a real Resend email. Do these on staging before the demo.
2. **Job concurrency limit is per Worker isolate** (6), not global. A burst spread across many isolates can still start many Whisper/LLM jobs at once. Per-IP burst limits and quotas bound it per user; a global limit would need a Durable Object or Queue (new infrastructure, not done).
3. **No data retention clean-up.** `cached_transcripts`, `cached_packs` (which include packs made from *uploaded* lectures), `jobs`, `daily_quotas`, `rate_limits`, `analytics_events`, `magic_links`, `webhook_events` grow forever. Add a scheduled clean-up and state the retention in the Privacy page.
4. **R2 lifecycle rule:** the Privacy page promises a 24 h backup deletion rule on the uploads bucket; that is a bucket setting I can't verify — set it (§4).
5. **Large uploads decode in the browser.** A 200 MB / multi-hour file is decoded to PCM in memory and can crash low-memory phones. Pre-existing design; not changed.
6. **Turnstile fails open** if Cloudflare's own verification endpoint is unreachable (per-IP limits still apply).
7. **Regional-price mismatch** withholds access but does not refund automatically. Watch logs for `REGION MISMATCH` (`wrangler pages deployment tail`) and refund in Lemon Squeezy.
8. **Test-mode webhooks grant real access** if a Lemon Squeezy *test* webhook points at production. Remove/disable the test webhook at launch.
9. **Bilingual fallback translation** fills at most 40 cards when the model omits translations, so very large paid packs can have some untranslated cards.
10. **Free plan detail:** a cached pack also uses the free user's 1 quiz/day. Change if you want cached packs to only cost ½ AI action.
11. Minor: login-CSRF on `/api/auth/verify` (an attacker could sign a victim into the attacker's account); CSV opened in Excel could evaluate cells starting with `=` (Anki is unaffected).

## 4. What you must configure before launch

**Secrets** (Cloudflare Pages → Settings → Variables and Secrets, or `npx wrangler pages secret put NAME --project-name textfromclip`):

| Name | What |
|---|---|
| `COOKIE_SECRET` | Random ≥ 32 chars (`openssl rand -base64 48`). **Required** — without it the API returns 503 in production. |
| `ADMIN_TOKEN` | Random ≥ 24 chars; use as `Authorization: Bearer …` for `/api/admin/costs`. |
| `RESEND_API_KEY` | Resend API key (magic-link emails). |
| `LEMONSQUEEZY_API_KEY` | LS API key (test-mode key first). |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Signing secret you set on the LS webhook. |
| `TURNSTILE_SECRET_KEY` | Turnstile widget secret. |

**Variables** (non-secret):

| Name | What |
|---|---|
| `LEMONSQUEEZY_STORE_ID` | Numeric store id. |
| `LEMONSQUEEZY_VARIANT_EXAM_PASS` / `_EXAM_PASS_REGIONAL` | Variant ids, $2.99 / $1.49, one-time. |
| `LEMONSQUEEZY_VARIANT_MONTHLY` / `_MONTHLY_REGIONAL` | Variant ids, $4.99 / $2.49 per month, subscription. |
| `LEMONSQUEEZY_VARIANT_SEMESTER_PASS` / `_SEMESTER_PASS_REGIONAL` | Variant ids, $14.99 / $7.49, one-time. |
| `EMAIL_FROM` | e.g. `LearnFromClip <login@learnfromclip.com>` (domain must be verified in Resend). |
| `APP_BASE_URL` | Optional, defaults to `https://learnfromclip.com` in production. |
| `VITE_TURNSTILE_SITE_KEY` | **Build-time** env var on the Pages project (Turnstile site key). |
| `IP_DAILY_AI_ACTIONS` etc. | Optional overrides for the per-IP ceiling. |

**Lemon Squeezy:** create the 3 products × 2 prices above (one-time for the passes, subscription for Monthly). Webhook URL `https://learnfromclip.com/api/webhooks/lemonsqueezy` with events `order_created`, `order_refunded`, `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, `subscription_expired`, `subscription_paused`, `subscription_unpaused`, `subscription_payment_refunded`. Do a full test-mode purchase → access → refund → access removed, then switch keys/variants to live mode. Add the refund policy URL (`/terms#refunds`) in the store settings.

**Turnstile:** create a widget for `learnfromclip.com` (invisible/managed); site key → `VITE_TURNSTILE_SITE_KEY`, secret → `TURNSTILE_SECRET_KEY`.

**Email (Resend):** add `learnfromclip.com`, add the SPF/DKIM DNS records it gives you, set `EMAIL_FROM`.

**DNS / Cloudflare:** custom domain `learnfromclip.com` (+ `www` redirect) on the Pages project; R2 lifecycle rule "delete after 1 day" on the uploads bucket; nothing needed for textfromclip.com.

**D1:** the only database in the Cloudflare account is `textfromclip-db` (`0dd853ee…`), which matches `wrangler.toml`; `learnfromclip-db` does not exist, so no change is needed. The production database currently has **only the 0001 tables**: the LearnFromClip tables from 0002 were never applied. Previously: `wrangler.toml` binds `textfromclip-db` (`0dd853ee…`), but your commit `2c6140f` bound a separate `learnfromclip-db` (`269a6c4e…`) that a later Gemini commit reverted. I did not change the binding. Pick the production database, set it in `wrangler.toml`/`pages/wrangler.toml` (and the dashboard binding), then run:
```bash
npm run d1:migrate:prod
```
(= `wrangler d1 migrations apply DB --remote`). If 0001/0002 were previously applied with `d1 execute --file`, the tool will re-run them; they are `IF NOT EXISTS` and safe, and 0003 then applies once.

## 5. Ready to launch?

**Not yet — but close.** The code-level blockers are fixed and covered by tests (183 unit/API, 62 E2E checks, axe clean, Lighthouse 98/99). Before launching or recording the demo:

1. Configure everything in §4 on a staging deployment.
2. On staging, run the flow once for real: a real YouTube lecture (≥ 1 h), a TikTok, an Instagram Reel and an uploaded recording; make a pack and check that the verifier keeps most items with the real model (look for `dropped_unverified_quotes` in the logs); a test-mode purchase, refund and subscription cancel; a real magic-link email.
3. Confirm the Terms refund policy and Privacy wording.

If those pass, it's ready to launch and to record the demo.
