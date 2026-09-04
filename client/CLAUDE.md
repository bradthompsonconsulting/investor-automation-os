# client/ — Marketing Site Guidance

Scope: the **public marketing site** under `client/`. This file loads only when working in this directory.

It does not govern the IAOS investor application under `app/` (see `docs/`), and it does not supersede the root `AGENTS.md` or the root `CLAUDE.md` — repo-wide governance, identity, transport rules and safety prohibitions live there.

## Design System

**"Kinetic Futurism"** — dark, glassmorphic, electric cyan accent.

Tokens and utilities are defined in `client/src/index.css`; that file is authoritative if this summary drifts.

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

Routes are registered in `client/src/App.tsx` — read that file for the current set rather than relying on a list here, which goes stale.

**Navigation** (`client/src/components/Navigation.tsx`): fixed top nav with glassmorphic background, desktop pill-style links, responsive mobile drawer. Nav items are declared in a `navItems` array; internal hrefs render through Wouter `<Link>`, with an `<a>` branch reserved for genuinely external hrefs. `/pricing` is an **internal** route and uses `<Link>`.

**`/pricing` is a native page.** `client/src/pages/Pricing.tsx` embeds `go.investorautomationos.com/pricing?noheader=true` in an iframe. It is not a `client/public/_redirects` rule — do not "restore" it as one. The hosted URL remains the authoritative payment destination.

When adding new pages: register the route in `App.tsx`, add a nav item in `Navigation.tsx` if it needs to be in the top nav, and follow the section pattern (alternating `bg-background` / `bg-secondary/70` with `section-grid` on the darker sections).

## Content Standards

Copy rules, audience framing, banned phrases, brand colors and pricing tiers are in the root `CLAUDE.md` under **Business Context & Content Standards**. They apply to all marketing copy written here.
