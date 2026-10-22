# TextFromClip — Production-Ready Video-to-Text Website

TextFromClip is a responsive, account-free web application that allows users to paste any supported public video URL and instantly receive a clean, readable, timestamped transcript with one-click copy and multi-format exports (TXT, SRT, VTT).

Built with **React**, **TypeScript**, **Tailwind CSS**, and deployed on **Cloudflare Workers** with **Cloudflare D1 (SQLite)** and **Cloudflare Workers AI**.

---

## 1. Visual Identity & Design Reproduction

The user interface reproduces the exact layout, color palette, typography, and visual hierarchy from the official design reference:

- **Colors**:
  - Primary Blue: `#3B82F6` (accent hover `#2563EB`)
  - Accent Purple: `#6D28D9` / `#7C3AED`
  - Dark Navy Text: `#0F172A`
  - Secondary Text: `#64748B`
  - Clean Background: `#FFFFFF` / Soft Background: `#F8FAFC`
  - Dark Mode: Full support with seamless persistence in `localStorage`
- **Logo Component** (`<Logo variant="full|icon" size="sm|md|lg|xl" />`):
  - Handcrafted SVG combining a rounded blue-to-purple gradient play shield, a white play triangle, 3 speed/text lines, and the "TextFromClip" wordmark.
- **Hero Mockup Illustration**:
  - Recreated in responsive CSS & SVG with a floating source link pill (`🔗 https://youtube.com/watch?v=abc123`), a curved directional indicator, a coastal video preview player card with playback controls (`0:00 / 2:34`), and an overlapping floating transcript card with timestamped lines.

---

## 2. Technology Stack & Cloudflare Infrastructure

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Frontend** | React 18, TypeScript, Tailwind CSS, Lucide Icons | Responsive SPA, accessible semantic controls, dark/light toggle |
| **Build Tool** | Vite 6 | Lightning-fast HMR and optimized production bundles |
| **Backend & Hosting** | Cloudflare Workers & Static Assets | Serverless edge execution with global CDN asset delivery |
| **Database** | Cloudflare D1 (SQLite) | Ephemeral job metadata, rate limiting, and aggregate telemetry |
| **AI Speech-to-Text** | Cloudflare Workers AI (`@cf/openai/whisper`) | Edge speech recognition for direct audio and video streams |
| **Testing** | Vitest | Comprehensive unit, integration, SSRF, and parser test suites |

---

## 3. Core Features & Capabilities

1. **Zero-Friction Link-to-Transcript**:
   - Paste any YouTube link (standard watch URL, `youtu.be` shortened link, YouTube Shorts, embed link).
   - Instant extraction of official author caption tracks and auto-generated subtitles.
2. **Interactive Transcript Result View**:
   - Live word search and filter within the transcript.
   - Clickable timestamps: clicking a timestamp opens the exact second on YouTube (`&t=X s`).
   - Toggle timestamps on/off.
   - **One-Click Copy** with toast confirmation.
   - **Download TXT**: clean plain text.
   - **Download SRT**: SubRip subtitle format with millisecond timecodes (`00:00:12,340 --> 00:00:16,900`).
   - **Download VTT**: WebVTT format for web video players (`00:00:12.340 --> 00:00:16.900`).
   - "Transcribe another video" quick action.
3. **Provider-Adapter Architecture**:
   - `YouTubeProvider`: Multi-language caption discovery, timedtext XML & JSON3 parsing, video title resolution.
   - `DirectMediaProvider`: Handles direct `.mp4`, `.webm`, `.mp3`, `.wav` links using Cloudflare Workers AI Whisper.
   - `TikTokProvider` & `InstagramProvider`: Discloses platform login restrictions honestly without fabricating synthetic mock data.
4. **Security & Abuse Mitigation**:
   - Strict SSRF protection: blocks private RFC1918 subnets, `127.0.0.1`, loopback, and cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`).
   - Distributed rate limiter tracking requests per minute.
   - Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
5. **Privacy First**:
   - No user accounts, passwords, or emails.
   - Videos are never saved permanently.
   - D1 job records expire automatically after 24 hours.
   - Zero advertising trackers.

---

## 4. Project Structure

```
textfromclip/
├── index.html                   # HTML entry with Inter font & SVG favicon
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript compiler config
├── tailwind.config.js           # Tailwind CSS configuration with brand colors
├── postcss.config.js            # PostCSS configuration
├── vite.config.ts               # Vite bundler with integrated Hono API dev middleware
├── wrangler.toml                # Cloudflare Workers, D1 & Workers AI configuration
├── migrations/
│   └── 0001_initial_schema.sql  # Cloudflare D1 schema (jobs, usage_events, rate_limits)
├── scripts/
│   └── run-load-test.js         # Executable concurrency & load test runner
└── src/
    ├── main.tsx                 # React entry point
    ├── App.tsx                  # Main app component
    ├── index.css                # Global styles and Tailwind directives
    ├── types/
    │   └── index.ts             # Shared TypeScript types
    ├── components/
    │   ├── Logo.tsx             # Reusable vector SVG logo (wordmark & icon)
    │   ├── Navbar.tsx           # Navigation, theme toggle, mobile drawer
    │   ├── Hero.tsx             # Hero section with input, trust pill, and UI illustration
    │   ├── TranscriptResultView.tsx # Transcript viewer with search, copy, SRT/VTT export
    │   ├── Features.tsx         # 4-card feature overview
    │   ├── HowItWorks.tsx       # 3-step workflow
    │   ├── SupportedPlatforms.tsx # Transparency platform status cards
    │   ├── Faq.tsx              # Interactive accordion FAQ
    │   ├── SeoPages.tsx         # SEO-optimized landing highlights
    │   ├── Modals.tsx           # Privacy Policy, Terms of Service, Contact modals
    │   └── Footer.tsx           # Minimalist legal and platform footer
    ├── server/
    │   ├── index.ts             # Hono API router for Cloudflare Workers
    │   ├── utils/
    │   │   ├── ssrf.ts          # SSRF prevention and URL validation
    │   │   ├── rate-limiter.ts  # Distributed sliding window rate limiter
    │   │   └── formatters.ts    # Timecode, SRT, VTT, and HTML unescaping
    │   └── providers/
    │       ├── base.ts          # VideoProviderAdapter interface
    │       ├── youtube.ts       # Real YouTube caption extraction adapter
    │       ├── direct-media.ts  # Workers AI Whisper audio transcription adapter
    │       ├── tiktok.ts        # TikTok platform adapter
    │       ├── instagram.ts     # Instagram Reels adapter
    │       └── registry.ts      # Adapter registry and dispatcher
    └── tests/
        ├── ssrf.test.ts         # Security and URL validation test suite
        ├── formatters.test.ts   # SRT/VTT and timestamp unit tests
        ├── youtube-provider.test.ts # YouTube extractor unit tests
        ├── api.test.ts          # Hono API integration tests
        ├── integration.test.ts  # Live YouTube caption verification test
        └── load-test.ts         # Concurrency test suite
```

---

## 5. Local Development Setup

### Prerequisites
- Node.js 18+ (tested on Node.js v24)
- npm 9+

### Installation & Run
```bash
# 1. Clone repository and install dependencies
cd textfromclip
npm install

# 2. Run local development server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser. The local development server runs the frontend and seamlessly proxies `/api/*` requests to the Hono backend handler.

### Running Tests
```bash
# Run unit and integration tests with Vitest
npm run test
```

### Building for Production
```bash
# Compiles TypeScript and builds optimized production bundles into dist/
npm run build
```

---

## 6. Cloudflare Deployment Guide

### Step 1: Login to Cloudflare Wrangler
```bash
npx wrangler login
```

### Step 2: Create Cloudflare D1 Database
```bash
npx wrangler d1 create textfromclip-db
```
Copy the generated `database_id` into your `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "textfromclip-db"
database_id = "your-database-id-here"
```

### Step 3: Run D1 Schema Migration
```bash
# Apply schema to local development D1 instance
npm run d1:migrate:local

# Apply schema to remote production D1 instance
npm run d1:migrate:prod
```

### Step 4: Deploy to Cloudflare Workers
```bash
npm run build
npm run deploy
```

---

## 7. Capacity & Load Testing: 20,000 Concurrent Active Users (CAU)

### Workload Modeling
A workload of 20,000 Concurrent Active Users (CAU) does **not** mean 20,000 requests hitting speech-to-text every second. In real-world SaaS traffic:
- **Browsing & Reading Users (85% = 17,000 users)**: Loading static HTML/CSS/JS, reading FAQs, browsing transcripts. Handled entirely by Cloudflare CDN edge caching with 0 ms server compute.
- **Link Submissions (10% = 2,000 users / 5-minute window)**: Submitting YouTube/video links. Translates to ~7 to 10 requests/second.
- **Active Export & Searches (5% = 1,000 users)**: Copying text, downloading SRT/VTT. Executed 100% client-side in the browser.

### Cloudflare Architectural Scalability
1. **Cloudflare Edge Workers**: Autoscales instantly across 300+ edge data centers. Cold-start latency is < 5 ms.
2. **YouTube Caption Extraction**: Lightweight HTTP fetch (< 200 KB) with no browser overhead. High throughput and zero GPU requirement.
3. **Cloudflare D1 SQLite**: Handles up to 100,000 reads/sec with edge read replicas. Writes are batched for minimal overhead. Full transcripts are never stored in D1 to prevent database bloat.
4. **Cloudflare Workers AI (Whisper)**: Rate-limited per account. For high-volume audio queues, requests are throttled with exponential backoff and backpressure signaling.

### Executing the Concurrency Load Test
Run the included load test script against your local or deployed instance:
```bash
node scripts/run-load-test.js http://localhost:5173 50 10
```
Parameters:
`node scripts/run-load-test.js [targetUrl] [virtualUsers] [durationSeconds]`
