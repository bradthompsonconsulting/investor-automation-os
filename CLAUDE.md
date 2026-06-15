# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (Express + Vite HMR on same port)
pnpm build        # Vite client build + esbuild server bundle → dist/
pnpm start        # Run production build
pnpm check        # TypeScript type-check (no emit)
pnpm test         # Run Vitest tests
pnpm db:push      # Generate Drizzle migration + apply to DB
pnpm format       # Prettier
```

Run a single test file: `pnpm vitest run server/auth.logout.test.ts`

## Architecture

This is a **public-facing marketing website** for Investor Automation OS (a real estate investor automation platform) built on the Manus web-app template: **React 19 + Wouter + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM (MySQL)**.

The template ships with full-stack capabilities (auth, database, LLM, storage, maps), but this project uses them minimally — the site is primarily static marketing content. The backend only exposes the boilerplate `auth.me` and `auth.logout` procedures; no custom database tables have been added yet.

**Data flow:** All backend calls go through tRPC at `/api/trpc`. The tRPC client is configured in `client/src/lib/trpc.ts` and provided globally in `client/src/main.tsx`. Framework plumbing (OAuth, DB connection, Vite bridge, env) lives under `server/_core/` — treat this as read-only infrastructure.

**Routing:** Wouter handles client-side routing in `client/src/App.tsx`. The app defaults to dark theme and has no auth-gated routes. External/redirect URLs are handled by Netlify-style rules in `client/public/_redirects` (e.g., `/pricing` → `go.investorautomationos.com/pricing`).

**Images:** All hero images and mockups are served from CloudFront CDN. Do not add image files to `client/public/` or `client/src/` — use the CDN URLs or `manus-upload-file` CLI and reference via `/manus-storage/`.

## Design System

**"Kinetic Futurism"** — dark, glassmorphic, electric cyan accent.

- Fonts: `Space Grotesk` (headings/display via `.font-display`) and `Inter` (body via `.font-sans`). Both loaded via Google Fonts in `client/index.html`.
- Primary accent: `--accent: #00D9FF` (electric cyan). Use `text-accent`, `bg-accent`, `border-accent/*`.
- Background: `#0A0E27` (charcoal). Cards/surfaces: `#1A1F4D` (deep indigo).
- `text-gradient` — cyan gradient text for hero headlines (`bg-clip-text` + transparent).
- `glass` — frosted glass panel (`bg-white/5 backdrop-blur-md border border-white/10`).
- `glass-card` — elevated card variant with heavier blur and shadow.
- `hover-lift` — lifts card up on hover with cyan border glow.
- `glow-cyan` / `glow-cyan-lg` — cyan drop-shadow utilities.
- `hero-mesh` — section background with radial cyan/indigo gradients.
- `section-grid` — pseudo-element subtle grid overlay for dark sections.
- `.container` is customized to auto-center + responsive padding; use it without `mx-auto`/`px-*`.

Animations use **Framer Motion** (`framer-motion`). Standard patterns used throughout:
- `fadeInUp` / `staggerContainer` for hero entrance
- `revealInView` (`whileInView`, `viewport: { once: true }`) for sections
- Animated counters with `useInView` + `requestAnimationFrame` (see `AnimatedCounter` in `Home.tsx`)

## Pages & Components

Pages live in `client/src/pages/`. Every page imports `Navigation` and `Footer` directly (no layout wrapper in `App.tsx`).

Current routes: `/`, `/services`, `/for-investors`, `/how-it-works`, `/demo`, `/about`, `/contact`, `/privacy`, `/terms`.

**Navigation** (`client/src/components/Navigation.tsx`): fixed top nav with glassmorphic background, desktop pill-style links, responsive mobile drawer. "Pricing" is an external `<a>` link, others use Wouter `<Link>`. CTA is "Book a Call" → `/contact`.

When adding new pages: register the route in `App.tsx`, add a nav item in `Navigation.tsx` if it needs to be in the top nav, and follow the section pattern (alternating `bg-background` / `bg-secondary/70` with `section-grid` on the darker sections).

## Key Files

```
client/src/App.tsx          ← Routes
client/src/index.css        ← Design tokens, custom utilities, global styles
client/public/_redirects    ← External URL redirects (Netlify/CDN rules)
client/src/components/Navigation.tsx
client/src/components/Footer.tsx
server/routers.ts           ← tRPC procedures (add features here)
drizzle/schema.ts           ← Database tables (extend here)
server/db.ts                ← Query helpers
server/_core/               ← Framework infrastructure (avoid editing)
```

## Business Context & Content Standards

**Brand:** Investor Automation OS (IAOS), owned by Brad Thompson Consulting LLC (BTC LLC).

**Brand colors** (use these when adding new UI elements outside the existing design system):
- Navy: `#07142E`
- Accent blue: `#1EC8FF`
- CTA blue: `#005CE6`
- Card containers: `#1B2433`
- Text: `#F5F7FA`

### Audience

**Investor-facing:** Beginner-to-intermediate wholesale real estate investors (0–10 deals). Copy should use pain amplification, ROI math, FOMO, and objection-crushing.

**Seller-facing:** Brad is a **wholesaler**, not a direct cash buyer. Never use language like "cash in 24 hours," "we buy houses," or any fast-cash buyer framing. Seller copy should be warm and empathetic early in the sequence, shifting to direct/urgent for re-engagement.

### Copy Rules

- **Banned phrase:** "just checking in" — never use this anywhere, in any context.
- Every investor-facing CTA section must link to `/pricing` (or `{{custom_values.investor_pricing}}` in GHL contexts) and the investor calendar.
- Do not include reschedule/cancel links in appointment confirmation copy — GHL handles this natively.
- All payment links live at `go.investorautomationos.com/pricing` (routed via `client/public/_redirects`).

### Pricing (live via Stripe + GHL)

| Tier | Setup | Monthly |
|---|---|---|
| Snapshot Only | $297 one-time | — |
| Snapshot + Setup | $497 | $197/mo |
| Snapshot + Setup + Support | $997 | $497/mo |

### Open Tasks (from IAOS Master To-Do)

- **CTA audit:** Replace all "Schedule Your Strategy Call" / "Book A Call" buttons site-wide with "Get Started Now" linking to `/pricing`. Verify every CTA points to the correct calendar or pricing URL.
- **About page:** Build out Brad's veteran story + Lion King strategy.
- **Software Demo page:** Build out `/demo` with product walkthrough content.

### Workflow Note

Brad works closely with Claude for copywriting and strategy. When writing new marketing copy from scratch, Claude writes the copy first — Jeff's role is implementation, not copywriting.
